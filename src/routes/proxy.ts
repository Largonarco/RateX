import { RateLimiter } from "../utils/rateLimiters";
import { QueueService } from "../utils/queueService";
import { AppError } from "../middleware/errorHandler";
import { Router, Request, Response, NextFunction } from "express";

const router = Router();

// Proxy middleware
router.use("/:appId/*", async (req: Request, res: Response, next: NextFunction) => {
	try {
		const { appId } = req.params;
		const path = req.params[0] || "";

		// Get application data
		const app = await req.app.get("redis").hgetall(`app:${appId}`);
		if (Object.keys(app).length === 0) {
			throw new AppError(404, "Application not found");
		}

		// Create rate limiter and queue service instances
		const queueService = new QueueService(req.app.get("redis"), req.app.get("serverId"));
		const rateLimiter = new RateLimiter(JSON.parse(app.rateLimit), req.app.get("redis"));

		// Check rate limit
		const isAllowed = await rateLimiter.checkLimit(appId);

		// If rate limited, enqueue the request
		if (!isAllowed) {
			const requestId = await queueService.enqueueRequest({
				appId,
				path,
				method: req.method,
				baseUrl: app.baseUrl,
				headers: req.headers as Record<string, string>,
				body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
			});

			// Return immediately with request ID
			return res.status(202).json({
				status: "queued",
				data: {
					requestId,
					message: "Request enqueued due to rate limit",
				},
			});
		}

		// If allowed, forward request to target API
		const headers = new Headers();
		Object.entries(req.headers).forEach(([key, value]) => {
			if (value) headers.set(key, value.toString());
		});
		headers.set("x-forwarded-for", req.ip || "");
		headers.set("host", new URL(app.baseUrl).host);

		const response = await fetch(`${app.baseUrl}/${path}`, {
			headers,
			method: req.method,
			body: req.method !== "GET" && req.method !== "HEAD" ? JSON.stringify(req.body) : undefined,
		});

		// Forward response back to client
		let responseData;
		const contentType = response.headers.get("content-type") || "";

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

// Add endpoint to check request status
router.get("/status/:requestId", async (req: Request, res: Response, next: NextFunction) => {
	try {
		const { requestId } = req.params;

		const queueService = new QueueService(req.app.get("redis"), req.app.get("serverId"));
		const status = await queueService.getRequestStatus(requestId);
		if (!status) {
			throw new AppError(404, "Request not found");
		}

		res.json({
			status: "success",
			data: status,
		});
	} catch (error) {
		next(error);
	}
});

export const proxyRouter = router;
