import { Redis } from "ioredis";
import { v4 as uuidv4 } from "uuid";

interface QueuedRequest {
	id: string;
	body?: any;
	path: string;
	appId: string;
	method: string;
	baseUrl: string;
	timestamp: number;
	headers: Record<string, string>;
}

export class QueueService {
	private redis: Redis;
	private serverId: string;

	constructor(redis: Redis, serverId: string) {
		this.redis = redis;
		this.serverId = serverId;
	}

	async enqueueRequest(request: Omit<QueuedRequest, "id" | "timestamp">): Promise<string> {
		const id = uuidv4();
		const queuedRequest: QueuedRequest = {
			...request,
			id,
			timestamp: Date.now(),
		};

		// Add to server-specific stream
		await this.redis.xadd(`stream:${this.serverId}`, "*", "request", JSON.stringify(queuedRequest));

		return id;
	}

	async getRequestStatus(requestId: string): Promise<{
		status: "pending" | "processing" | "completed" | "failed";
		response?: any;
	}> {
		const response = await this.redis.get(`response:${requestId}`);

		if (!response) {
			return { status: "pending" };
		}

		return JSON.parse(response);
	}
}
