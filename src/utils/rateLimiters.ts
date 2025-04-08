import { AppError } from "../middleware/errorHandler";
import { Redis } from "ioredis";

export interface IRateLimitConfig {
	window: number;
	burst?: number;
	requests: number;
	leakRate?: number;
	refillRate?: number;
	strategy: "fixed_window" | "sliding_window" | "token_bucket" | "leaky_bucket" | "sliding_log";
}

export class RateLimiter {
	private config: IRateLimitConfig;
	private redis: Redis;

	constructor(config: IRateLimitConfig, redis: Redis) {
		this.config = config;
		this.redis = redis;
	}

	async checkLimit(key: string): Promise<boolean> {
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
	}

	// Fixed Window
	private async fixedWindow(key: string): Promise<boolean> {
		const now = Date.now();
		const windowKey = `fixed:${key}:${Math.floor(now / (this.config.window * 1000))}`;

		while (true) {
			await this.redis.watch(windowKey);

			const current = await this.redis.get(windowKey);
			const count = current ? parseInt(current) : 0;

			if (count >= this.config.requests) {
				await this.redis.unwatch();
				return false;
			}

			const multi = this.redis.multi();
			multi.incr(windowKey);
			multi.expire(windowKey, this.config.window);

			const result = await multi.exec();
			if (result) {
				return true;
			}
			// If exec returns null, the key was modified, retry
		}
	}

	// Sliding Window
	private async slidingWindow(key: string): Promise<boolean> {
		const now = Date.now();
		const windowKey = `sliding:${key}`;
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

			const multi = this.redis.multi();
			multi.incr(`${windowKey}:${currentWindow}`);
			multi.expire(`${windowKey}:${currentWindow}`, this.config.window * 2);

			const execResult = await multi.exec();
			if (execResult) {
				return true;
			}
			// If exec returns null, the keys were modified, retry
		}
	}

	// Token Bucket
	private async tokenBucket(key: string): Promise<boolean> {
		const now = Date.now();
		const bucketKey = `bucket:${key}`;
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

			const multi = this.redis.multi();
			multi.hset(bucketKey, "tokens", (currentTokens - 1).toString());
			multi.hset(bucketKey, "lastRefill", now.toString());
			multi.expire(bucketKey, Math.ceil(burst / refillRate) * 2);

			const execResult = await multi.exec();
			if (execResult) {
				return true;
			}
			// If exec returns null, the key was modified, retry
		}
	}

	// Leaky Bucket
	private async leakyBucket(key: string): Promise<boolean> {
		const now = Date.now();
		const bucketKey = `leaky:${key}`;
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

			const multi = this.redis.multi();
			multi.hset(bucketKey, "count", (currentCount + 1).toString());
			multi.hset(bucketKey, "lastLeak", now.toString());
			multi.expire(bucketKey, Math.ceil(this.config.requests / leakRate) * 2);

			const execResult = await multi.exec();
			if (execResult) {
				return true;
			}
			// If exec returns null, the key was modified, retry
		}
	}

	// Sliding Log
	private async slidingLog(key: string): Promise<boolean> {
		const now = Date.now();
		const logKey = `log:${key}`;
		const windowSize = this.config.window * 1000;
		const cutoff = now - windowSize;

		while (true) {
			await this.redis.watch(logKey);

			const multi = this.redis.multi();
			multi.zremrangebyscore(logKey, 0, cutoff);
			multi.zcard(logKey);

			const result = await multi.exec();
			if (!result) continue;

			const count = result[1][1] as number;

			if (count >= this.config.requests) {
				await this.redis.unwatch();
				return false;
			}

			const addMulti = this.redis.multi();
			addMulti.zadd(logKey, now.toString(), now.toString());
			addMulti.expire(logKey, this.config.window);

			const execResult = await addMulti.exec();
			if (execResult) {
				return true;
			}
			// If exec returns null, the key was modified, retry
		}
	}
}

export const createRateLimiter = (config: IRateLimitConfig, redis: Redis): RateLimiter => {
	return new RateLimiter(config, redis);
};
