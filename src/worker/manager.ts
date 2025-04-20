import { Redis } from "ioredis";
import { fork } from "child_process";
import { join } from "path";

interface WorkerInfo {
	process: any;
	consumerId: string;
}

export class WorkerManager {
	private redis: Redis;
	private serverId: string;
	private groupKey: string;
	private streamKey: string;
	private maxWorkers: number;
	private maxStreamLength: number;
	private maxQueuedRequests: number;
	private checkInterval!: NodeJS.Timeout;
	private isShuttingDown: boolean = false;
	private workers: Map<string, WorkerInfo>;
	private static readonly MAX_SERVER_ID = 100; // Maximum number of server IDs to create
	private static readonly SERVER_POOL_KEY = "server:pool";

	constructor(
		redis: Redis,
		serverId: string,
		config: { maxQueuedRequests?: number; maxWorkers?: number; maxStreamLength?: number } = {}
	) {
		this.redis = redis;
		this.serverId = serverId;
		this.workers = new Map();
		this.groupKey = `group:${serverId}`;
		this.streamKey = `stream:${serverId}`;
		this.maxWorkers = config.maxWorkers ?? 10;
		this.maxStreamLength = config.maxStreamLength ?? 10000;
		this.maxQueuedRequests = config.maxQueuedRequests ?? 100;
	}

	static async getAvailableServerId(redis: Redis): Promise<string> {
		// Try to get an available server ID from the pool
		const availableId = await redis.spop(WorkerManager.SERVER_POOL_KEY);
		if (availableId) {
			return availableId;
		}

		// If no available ID, create a new one
		const currentCount = await redis.incr("server:counter");
		if (currentCount > WorkerManager.MAX_SERVER_ID) {
			throw new Error("Maximum number of server IDs reached");
		}

		return `server:${currentCount}`;
	}

	async start() {
		// Create consumer group if it doesn't exist
		try {
			await this.redis.xgroup("CREATE", this.streamKey, this.groupKey, "0", "MKSTREAM");
		} catch (error) {
			// If group already exists, that's fine
			if (!(error instanceof Error) || !error.message.includes("BUSYGROUP")) {
				throw error;
			}
		}

		// Start monitoring queue size and managing workers
		this.checkInterval = setInterval(() => this.manageWorkers(), 5000);
	}

	private async manageWorkers() {
		if (this.isShuttingDown) return;

		// Get current worker count
		const currentWorkers = this.workers.size;
		// Get current queue length
		const queueLength = await this.redis.xlen(this.streamKey);

		// Trim stream if it exceeds max length
		if (queueLength > this.maxStreamLength) {
			// Get the ID of the oldest message that's not in pending state
			const pendingInfo = (await this.redis.xpending(this.streamKey, this.groupKey, "-", "+", 1)) as [
				string,
				string,
				number,
				number
			][];

			if (pendingInfo && pendingInfo.length > 0) {
				const oldestPendingId = pendingInfo[0][0];
				// Trim stream up to the oldest pending message
				await this.redis.xtrim(this.streamKey, "MINID", oldestPendingId);
			}
		}

		// Scale workers based on queue length
		if ((queueLength > this.maxQueuedRequests || queueLength === 0) && currentWorkers < this.maxWorkers) {
			await this.spawnWorker();
		} else if (queueLength < this.maxQueuedRequests / 2 && currentWorkers > 1) {
			await this.removeWorker();
		}
	}

	private async spawnWorker() {
		const workerId = `worker:${Date.now()}`;
		const consumerId = `${this.serverId}:${workerId}`;

		const worker = fork(join(__dirname, "process.js"), [], {
			env: {
				...process.env,
				CONSUMER_ID: consumerId,
				SERVER_ID: this.serverId,
				REDIS_URL: process.env.REDIS_URL,
			},
		});

		this.workers.set(workerId, {
			consumerId,
			process: worker,
		});

		worker.on("exit", () => {
			this.workers.delete(workerId);
		});
	}

	private async removeWorker() {
		// Remove any arbitrary worker
		const worker = this.workers.values().next().value;

		if (worker) {
			worker.process.kill();
			this.workers.delete(worker.consumerId);

			// Wait for the worker to complete processing and then remove the consumer
			await new Promise((resolve) => setTimeout(resolve, 1000));
			await this.redis.xgroup("DELCONSUMER", this.streamKey, this.groupKey, worker.consumerId);
		}
	}

	async shutdown() {
		try {
			// Set flag and clear interval
			this.isShuttingDown = true;
			clearInterval(this.checkInterval);

			// Killing all workers and deleting consumers
			for (const [workerId, workerInfo] of this.workers) {
				workerInfo.process.kill();
				this.workers.delete(workerId);
				await this.redis.xgroup("DELCONSUMER", this.streamKey, this.groupKey, workerInfo.consumerId);
			}

			// Return server ID to the pool
			await this.redis.sadd(WorkerManager.SERVER_POOL_KEY, this.serverId);

			console.log("Server ID returned to pool and workers shut down successfully");
		} catch (error) {
			console.error("Error during shutdown:", error);
		}
	}
}
