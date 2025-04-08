import { AppError } from "../middleware/errorHandler";
import { Router, Request, Response, NextFunction } from "express";
import { authenticateJWT, authenticateAPIKey } from "../middleware/auth";
import { v4 as uuidv4 } from "uuid";

const router = Router();

// POST /apps
// Creates new service (app) to proxy
// Needs JWT
// Request body:
// {
// 	name: string;
// 	baseUrl: string;
// 	rateLimit: IRateLimit;
// }
router.post(
	"/",
	authenticateJWT,
	authenticateAPIKey,
	async (req: Request & { userEmail?: string }, res: Response, next: NextFunction) => {
		try {
			const { name, baseUrl, rateLimit } = req.body;

			// Validating
			if (!name || !baseUrl || !rateLimit) {
				throw new AppError(400, "Name, baseUrl, and rateLimit are required");
			}
			if (!["fixed_window", "sliding_window", "token_bucket"].includes(rateLimit.strategy)) {
				throw new AppError(400, "Invalid rate limiting strategy");
			}
			if (!rateLimit.requests || !rateLimit.window) {
				throw new AppError(400, "Rate limit requests and window are required");
			}

			// Store app data in Redis hash
			const appId = `app:${uuidv4()}`;
			await req.app.get("redis").hset(appId, {
				name,
				baseUrl,
				id: appId,
				userId: req.userEmail,
				rateLimit: JSON.stringify(rateLimit),
			});
			// Add app ID to user's apps list
			await req.app.get("redis").sadd(`user:${req.userEmail}:apps`, appId);

			res.status(201).json({
				status: "success",
				data: {
					app: {
						name,
						baseUrl,
						id: appId,
						rateLimit,
					},
				},
			});
		} catch (error) {
			next(error);
		}
	}
);

// GET /apps
// Gets all applications for user
// Needs JWT and API key
router.get(
	"/",
	authenticateJWT,
	authenticateAPIKey,
	async (req: Request & { userEmail?: string }, res: Response, next: NextFunction) => {
		try {
			// Get all app IDs for the user
			const appIds = await req.app.get("redis").smembers(`user:${req.userEmail}:apps`);

			// Get all apps data
			const apps = await Promise.all(
				appIds.map(async (appId: string) => {
					const appData = await req.app.get("redis").hgetall(appId);
					return {
						id: appId,
						name: appData.name,
						baseUrl: appData.baseUrl,
						rateLimit: JSON.parse(appData.rateLimit),
					};
				})
			);

			res.status(200).json({
				status: "success",
				data: { apps },
			});
		} catch (error) {
			next(error);
		}
	}
);

// GET /apps/:appId
// Gets application by ID
// Needs JWT and API key
// Request Params:
// {
// 	appId: string;
// }
router.get(
	"/:appId",
	authenticateJWT,
	authenticateAPIKey,
	async (req: Request & { userEmail?: string }, res: Response, next: NextFunction) => {
		try {
			const appId = `app:${req.params.appId}`;

			// Verify app belongs to user
			const isUserApp = await req.app.get("redis").sismember(`user:${req.userEmail}:apps`, appId);
			if (!isUserApp) {
				throw new AppError(404, "Application not found");
			}

			const appData = await req.app.get("redis").hgetall(appId);
			if (!appData.name) {
				throw new AppError(404, "Application not found");
			}

			res.status(200).json({
				status: "success",
				data: {
					app: {
						id: appId,
						name: appData.name,
						baseUrl: appData.baseUrl,
						rateLimit: JSON.parse(appData.rateLimit),
					},
				},
			});
		} catch (error) {
			next(error);
		}
	}
);

// PUT /apps/:appId
// Updates application by ID
// Needs JWT and API key
// Request Params:
// {
// 	appId: string;
// }
// Request Body:
// {
// 	name: string;
// 	baseUrl: string;
// 	rateLimit: IRateLimit;
// }
router.put(
	"/:appId",
	authenticateJWT,
	authenticateAPIKey,
	async (req: Request & { userEmail?: string }, res: Response, next: NextFunction) => {
		try {
			const { name, baseUrl, rateLimit } = req.body;
			const appId = `app:${req.params.appId}`;

			// Verify app belongs to user
			const isUserApp = await req.app.get("redis").sismember(`user:${req.userEmail}:apps`, appId);
			if (!isUserApp) {
				throw new AppError(404, "Application not found");
			}

			// Update app data
			const updates: Record<string, string> = {};
			if (name) updates.name = name;
			if (baseUrl) updates.baseUrl = baseUrl;
			if (rateLimit) updates.rateLimit = JSON.stringify(rateLimit);

			if (Object.keys(updates).length > 0) {
				await req.app.get("redis").hset(appId, updates);
			}

			// Get updated app data
			const appData = await req.app.get("redis").hgetall(appId);

			res.status(200).json({
				status: "success",
				data: {
					app: {
						id: appId,
						name: appData.name,
						baseUrl: appData.baseUrl,
						rateLimit: JSON.parse(appData.rateLimit),
					},
				},
			});
		} catch (error) {
			next(error);
		}
	}
);

// DELETE /apps/:appId
// Deletes application by ID
// Needs JWT and API key
// Request Params:
// {
// 	appId: string;
// }
router.delete(
	"/:appId",
	authenticateJWT,
	authenticateAPIKey,
	async (req: Request & { userEmail?: string }, res: Response, next: NextFunction) => {
		try {
			const appId = `app:${req.params.appId}`;

			// Verify app belongs to user
			const isUserApp = await req.app.get("redis").sismember(`user:${req.userEmail}:apps`, appId);
			if (!isUserApp) {
				throw new AppError(404, "Application not found");
			}

			// Delete app data and remove from user's apps list
			await Promise.all([
				req.app.get("redis").del(appId),
				req.app.get("redis").srem(`user:${req.userEmail}:apps`, appId),
			]);

			res.status(200).json({
				status: "success",
				data: {
					message: "Application deleted successfully",
				},
			});
		} catch (error) {
			next(error);
		}
	}
);

// GET /apps/:appId/stats
// Gets request statistics for an application
// Needs JWT and API key
router.get(
	"/:appId/stats",
	authenticateJWT,
	authenticateAPIKey,
	async (req: Request & { userEmail?: string }, res: Response, next: NextFunction) => {
		try {
			const appId = `app:${req.params.appId}`;

			// Verify app belongs to user
			const isUserApp = await req.app.get("redis").sismember(`user:${req.userEmail}:apps`, appId);
			if (!isUserApp) {
				throw new AppError(404, "Application not found");
			}

			// Get request statistics
			const totalRequests = (await req.app.get("redis").hget(`${appId}`, "totalRequests")) as string;

			res.status(200).json({
				status: "success",
				data: {
					stats: {
						totalRequests,
					},
				},
			});
		} catch (error) {
			next(error);
		}
	}
);

export const appsRouter = router;
