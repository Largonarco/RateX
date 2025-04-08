import { Request } from "express";
import { Redis } from "ioredis";

declare global {
	namespace Express {
		interface Request {
			userEmail?: string;
		}
		interface Application {
			get(name: "redis"): Redis;
		}
	}
}

export {};
