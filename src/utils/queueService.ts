import { Redis } from "ioredis";
import { createRateLimiter } from "./rateLimiters";

interface QueuedRequest {
	id: string;
	appId: string;
	path: string;
	method: string;
	headers: Record<string, string>;
	body?: any;
	timestamp: number;
}

export class QueueService {
	private redis: Redis;
	private processing: boolean = false;

	constructor(redis: Redis) {
		this.redis = redis;
	}

	async enqueueRequest(request: Omit<QueuedRequest, "id" | "timestamp">): Promise<string> {
		const id = `req:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;
		const queuedRequest: QueuedRequest = {
			...request,
			id,
			timestamp: Date.now(),
		};

		// Add to sorted set with timestamp as score
		await this.redis.zadd(`queue:${request.appId}`, Date.now(), JSON.stringify(queuedRequest));

		// Start processing if not already running
		if (!this.processing) {
			this.startProcessing();
		}

		return id;
	}

	private async startProcessing() {
		if (this.processing) return;
		this.processing = true;

		while (this.processing) {
			try {
				// Get all app IDs with queued requests
				const appIds = await this.redis.keys("queue:*");

				for (const appKey of appIds) {
					const appId = appKey.split(":")[1];

					// Get oldest request from queue
					const [requestStr] = await this.redis.zrange(appKey, 0, 0);
					if (!requestStr) continue;

					const request: QueuedRequest = JSON.parse(requestStr);

					// Check if we can process this request
					const rateLimiter = createRateLimiter(
						JSON.parse((await this.redis.hget(`app:${appId}`, "rateLimit")) || "{}"),
						this.redis
					);

					const canProcess = await rateLimiter.checkLimit(appId);

					if (canProcess) {
						// Remove from queue
						await this.redis.zrem(appKey, requestStr);

						// Process request
						await this.processRequest(request);
					} else {
						// If we can't process the oldest request, wait a bit
						await new Promise((resolve) => setTimeout(resolve, 1000));
					}
				}

				// If no requests to process, wait a bit
				if (appIds.length === 0) {
					await new Promise((resolve) => setTimeout(resolve, 1000));
				}
			} catch (error) {
				console.error("Error processing queue:", error);
				await new Promise((resolve) => setTimeout(resolve, 5000));
			}
		}
	}

	private async processRequest(request: QueuedRequest) {
		try {
			const app = await this.redis.hgetall(`app:${request.appId}`);
			const targetUrl = `${app.baseUrl}/${request.path}`;

			const response = await fetch(targetUrl, {
				method: request.method,
				headers: request.headers,
				body: request.method !== "GET" && request.method !== "HEAD" ? JSON.stringify(request.body) : undefined,
			});
		} catch (error) {
			console.error(`Error processing request ${request.id}:`, error);
		}
	}

	async stopProcessing() {
		this.processing = false;
	}

	async getRequestStatus(requestId: string) {
		const response = await this.redis.get(`response:${requestId}`);
		return response ? JSON.parse(response) : null;
	}
}

export const createQueueService = (redis: Redis): QueueService => {
	return new QueueService(redis);
};
