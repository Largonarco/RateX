import { connectRedis } from "../db/redis";
import { RateLimiter } from "../utils/rateLimiters";

class Worker {
	private redis: any;
	private serverId: string;
	private redisUrl: string;
	private groupKey: string;
	private streamKey: string;
	private consumerId: string;
	private isShuttingDown: boolean = false;

	constructor() {
		this.serverId = process.env.SERVER_ID || "";
		this.redisUrl = process.env.REDIS_URL || "";

		this.groupKey = `group:${this.serverId}`;
		this.streamKey = `stream:${this.serverId}`;
		this.consumerId = process.env.CONSUMER_ID || "";

		if (!this.serverId || !this.consumerId || !this.redisUrl) {
			console.error("Missing required environment variables");
			process.exit(1);
		}

		// Add signal handlers for graceful shutdown
		process.on("SIGINT", () => this.shutdown());
		process.on("SIGTERM", () => this.shutdown());
	}

	private async initialize() {
		this.redis = await connectRedis();
	}

	private async processRequest(request: any) {
		try {
			const rateLimiter = new RateLimiter(
				JSON.parse((await this.redis.hget(`app:${request.appId}`, "rateLimit")) || "{}"),
				this.redis
			);

			const canProcess = await rateLimiter.checkLimit(request.appId);
			if (!canProcess) {
				// If rate limited, re-add to stream with delay
				await this.redis.xadd(
					this.streamKey,
					"*",
					"request",
					JSON.stringify({
						...request,
						timestamp: Date.now(),
					})
				);
				return;
			}

			const response = await fetch(`${request.baseUrl}/${request.path}`, {
				method: request.method,
				headers: request.headers,
				body: request.method !== "GET" && request.method !== "HEAD" ? JSON.stringify(request.body) : undefined,
			});

			// Store only status code and status
			await this.redis.setex(
				`response:${request.id}`,
				172800, // 48 hours
				JSON.stringify({
					status: "completed",
					statusCode: response.status,
				})
			);
		} catch (error) {
			console.error(`Error processing request ${request.id}:`, error);
			await this.redis.setex(
				`response:${request.id}`,
				172800,
				JSON.stringify({
					status: "failed",
					error: error instanceof Error ? error.message : "Unknown error",
				})
			);
		}
	}

	private async processStream() {
		while (!this.isShuttingDown) {
			try {
				// Read from stream with a timeout and batch size of 3
				const result = await this.redis.xreadgroup(
					"GROUP",
					this.groupKey,
					this.consumerId,
					"COUNT",
					"3",
					"BLOCK",
					"5000",
					"STREAMS",
					this.streamKey,
					">"
				);

				if (!result) continue;

				const [stream, messages] = result[0];
				if (!messages || messages.length === 0) continue;

				// Process all messages in the batch
				const processingPromises = messages.map(async ([messageId, fields]: [string, string[]]) => {
					const request = JSON.parse(fields[1]);
					await this.processRequest(request);

					// Acknowledge message after processing
					await this.redis.xack(this.streamKey, this.groupKey, messageId);
				});

				// Wait for all messages in the batch to be processed
				await Promise.all(processingPromises);
			} catch (error) {
				if (this.isShuttingDown) break;
				console.error("Error in worker process:", error);
				await new Promise((resolve) => setTimeout(resolve, 5000));
			}
		}
	}

	private async shutdown() {
		this.isShuttingDown = true;

		// Wait for current processing to complete before closing redis connection
		await new Promise((resolve) => setTimeout(resolve, 1000));
		await this.redis.quit();

		process.exit(0);
	}

	public async start() {
		try {
			await this.initialize();
			await this.processStream();
		} catch (error) {
			console.error("Fatal error in worker process:", error);
			process.exit(1);
		}
	}
}

// Create and start the worker
const worker = new Worker();
worker.start();
