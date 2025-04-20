import { AppError } from "../middleware/errorHandler";
import { Redis } from "ioredis";

export interface IRateLimitConfig {
	window: number;
	burst?: number;
	requests: number;
	leakRate?: number;
	refillRate?: number;
	clusterConfig?: {
		timeout?: number;
		maxRetries?: number;
	};
	strategy: "fixed_window" | "sliding_window" | "token_bucket" | "leaky_bucket" | "sliding_log";
}

export class RateLimiter {
	private redis: Redis;
	private timeout: number;
	private maxRetries: number;
	private config: IRateLimitConfig;

	constructor(config: IRateLimitConfig, redis: Redis) {
		this.redis = redis;
		this.config = config;
		this.timeout = config.clusterConfig?.timeout || 5000;
		this.maxRetries = config.clusterConfig?.maxRetries || 3;
	}

	private isClusterError(error: unknown): boolean {
		if (!(error instanceof Error)) return false;
		return error.message.includes("MOVED") || error.message.includes("ASK");
	}

	private async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
		let retries = 0;
		let lastError: Error | null = null;

		while (retries < this.maxRetries) {
			try {
				return await operation();
			} catch (error) {
				lastError = error as Error;
				if (this.isClusterError(error)) {
					retries++;
					await new Promise((resolve) => setTimeout(resolve, this.timeout));
					continue;
				}
				throw error;
			}
		}

		throw new AppError(500, `Operation failed after ${retries} retries: ${lastError?.message}`);
	}

	async checkLimit(key: string): Promise<boolean> {
		return this.executeWithRetry(async () => {
			switch (this.config.strategy) {
				case "fixed_window":
					return this.fixedWindow(key);
				case "sliding_window":
					return this.slidingWindow(key);
				case "token_bucket":
					return this.tokenBucket(key);
				case "leaky_bucket":
					return this.leakyBucket(key);
				case "sliding_log":
					return this.slidingLog(key);
				default:
					throw new AppError(400, "Invalid rate limiting strategy");
			}
		});
	}

	// Fixed Window
	private async fixedWindow(key: string): Promise<boolean> {
		const now = Date.now();
		const windowKey = `{fixed:${key}}:${Math.floor(now / (this.config.window * 1000))}`;

		while (true) {
			await this.redis.watch(windowKey);

			const current = await this.redis.get(windowKey);
			const count = current ? parseInt(current) : 0;

			if (count >= this.config.requests) {
				await this.redis.unwatch();
				return false;
			}

			const result = await this.redis.multi().incr(windowKey).expire(windowKey, this.config.window).exec();

			if (result) {
				return true;
			}
			// If exec returns null, the key was modified, retry
		}
	}

	// Sliding Window
	private async slidingWindow(key: string): Promise<boolean> {
		const now = Date.now();
		const windowKey = `{sliding:${key}}`;
		const currentWindow = Math.floor(now / (this.config.window * 1000));
		const previousWindow = currentWindow - 1;

		while (true) {
			await this.redis.watch(`${windowKey}:${currentWindow}`, `${windowKey}:${previousWindow}`);

			const result = await this.redis
				.multi()
				.get(`${windowKey}:${currentWindow}`)
				.get(`${windowKey}:${previousWindow}`)
				.exec();

			if (!result) continue;

			const currentCount = parseInt(result[0][1] as string) || 0;
			const previousCount = parseInt(result[1][1] as string) || 0;

			const windowElapsed = (now % (this.config.window * 1000)) / (this.config.window * 1000);
			const threshold = previousCount * (1 - windowElapsed) + currentCount;

			if (threshold >= this.config.requests) {
				await this.redis.unwatch();
				return false;
			}

			const execResult = await this.redis
				.multi()
				.incr(`${windowKey}:${currentWindow}`)
				.expire(`${windowKey}:${currentWindow}`, this.config.window * 2)
				.exec();

			if (execResult) {
				return true;
			}
			// If exec returns null, the keys were modified, retry
		}
	}

	// Token Bucket
	private async tokenBucket(key: string): Promise<boolean> {
		const now = Date.now();
		const bucketKey = `{bucket:${key}}`;
		const refillRate = this.config.refillRate || 1;
		const burst = this.config.burst || this.config.requests;

		while (true) {
			await this.redis.watch(bucketKey);

			const result = await this.redis.multi().hget(bucketKey, "tokens").hget(bucketKey, "lastRefill").exec();

			if (!result) continue;

			const tokens = result[0][1] as string | null;
			const lastRefill = result[1][1] as string | null;

			let currentTokens = tokens ? parseFloat(tokens) : burst;
			const lastRefillTime = lastRefill ? parseFloat(lastRefill) : now;

			const timePassed = (now - lastRefillTime) / 1000;
			const newTokens = timePassed * refillRate;
			currentTokens = Math.min(burst, currentTokens + newTokens);

			if (currentTokens < 1) {
				await this.redis.unwatch();
				return false;
			}

			const execResult = await this.redis
				.multi()
				.hset(bucketKey, "tokens", (currentTokens - 1).toString())
				.hset(bucketKey, "lastRefill", now.toString())
				.expire(bucketKey, Math.ceil(burst / refillRate) * 2)
				.exec();

			if (execResult) {
				return true;
			}
			// If exec returns null, the key was modified, retry
		}
	}

	// Leaky Bucket
	private async leakyBucket(key: string): Promise<boolean> {
		const now = Date.now();
		const bucketKey = `{leaky:${key}}`;
		const leakRate = this.config.leakRate || 1;

		while (true) {
			await this.redis.watch(bucketKey);

			const result = await this.redis.multi().hget(bucketKey, "count").hget(bucketKey, "lastLeak").exec();

			if (!result) continue;

			const count = result[0][1] as string | null;
			const lastLeak = result[1][1] as string | null;

			let currentCount = count ? parseInt(count) : 0;
			const lastLeakTime = lastLeak ? parseFloat(lastLeak) : now;

			const timePassed = (now - lastLeakTime) / 1000;
			const leaked = Math.floor(timePassed * leakRate);
			currentCount = Math.max(0, currentCount - leaked);

			if (currentCount >= this.config.requests) {
				await this.redis.unwatch();
				return false;
			}

			const execResult = await this.redis
				.multi()
				.hset(bucketKey, "count", (currentCount + 1).toString())
				.hset(bucketKey, "lastLeak", now.toString())
				.expire(bucketKey, Math.ceil(this.config.requests / leakRate) * 2)
				.exec();

			if (execResult) {
				return true;
			}
			// If exec returns null, the key was modified, retry
		}
	}

	// Sliding Log
	private async slidingLog(key: string): Promise<boolean> {
		const now = Date.now();
		const logKey = `{log:${key}}`;
		const windowSize = this.config.window * 1000;
		const cutoff = now - windowSize;

		while (true) {
			await this.redis.watch(logKey);

			const result = await this.redis.multi().zremrangebyscore(logKey, 0, cutoff).zcard(logKey).exec();

			if (!result) continue;

			const count = result[1][1] as number;

			if (count >= this.config.requests) {
				await this.redis.unwatch();
				return false;
			}

			const execResult = await this.redis
				.multi()
				.zadd(logKey, now.toString(), now.toString())
				.expire(logKey, this.config.window)
				.exec();

			if (execResult) {
				return true;
			}
			// If exec returns null, the key was modified, retry
		}
	}
}
