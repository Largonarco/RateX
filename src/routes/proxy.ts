import { AppError } from "../middleware/errorHandler";
import { createRateLimiter } from "../utils/rateLimiters";
import { Router, Request, Response, NextFunction } from "express";

const router = Router();

// Proxy middleware
router.use("/:appId/*", async (req: Request, res: Response, next: NextFunction) => {
	try {
		const path = req.params[0];
		const { appId } = req.params;

		// Get application data
		const app = await req.app.get("redis").hgetall(`app:${appId}`);
		if (Object.keys(app).length === 0) {
			throw new AppError(404, "Application not found");
		}

		// Create rate limiter instance with Redis
		const rateLimiter = createRateLimiter(JSON.parse(app.rateLimit), req.app.get("redis"));

		// Check rate limit
		const isAllowed = await rateLimiter.checkLimit(`${appId}`);
		if (!isAllowed) {
			throw new AppError(429, "Rate limit exceeded");
		}

		// Forward request to target API
		const headers = new Headers();
		const targetUrl = `${app.baseUrl}/${path}`;
		Object.entries(req.headers).forEach(([key, value]) => {
			if (value) headers.set(key, value.toString());
		});
		headers.set("x-forwarded-for", req.ip || "");
		headers.set("host", new URL(app.baseUrl).host);

		const response = await fetch(targetUrl, {
			headers,
			method: req.method,
			body: req.method !== "GET" && req.method !== "HEAD" ? JSON.stringify(req.body) : undefined,
		});

		// Forward response to client
		const contentType = response.headers.get("content-type") || "";
		let responseData;

		if (contentType.includes("application/json")) {
			responseData = await response.json();
		} else if (contentType.includes("text/")) {
			responseData = await response.text();
		} else {
			responseData = await response.arrayBuffer();
		}

		res.status(response.status).set(Object.fromEntries(response.headers.entries())).send(responseData);
	} catch (error) {
		if (error instanceof AppError) {
			next(error);
		} else if (error instanceof Error) {
			next(new AppError(500, error.message));
		} else {
			next(new AppError(500, "Internal server error"));
		}
	}
});

export const proxyRouter = router;
