import { Redis } from "ioredis";

let redis: Redis;

export const connectRedis = async (): Promise<Redis> => {
	try {
		redis = new Redis({
			password: process.env.REDIS_PASSWORD,
			host: process.env.REDIS_HOST || "localhost",
			port: parseInt(process.env.REDIS_PORT || "6379"),
			db: parseInt(process.env.REDIS_DB || "0"),
			retryStrategy: (times) => {
				const delay = Math.min(times * 50, 2000);
				return delay;
			},
		});

		redis.on("error", (error) => {
			console.error("Redis error:", error);
		});
		redis.on("connect", () => {
			console.log("Connected to Redis");
		});

		// Verify connection
		await redis.ping();

		return redis;
	} catch (error) {
		console.error("Failed to connect to Redis:", error);
		throw error;
	}
};
