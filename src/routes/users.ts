import { Router, Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { AppError } from "../middleware/errorHandler";
import { authenticateJWT } from "../middleware/auth";

const router = Router();

// POST /users
// Registers new user
// Request body:
// {
// 	email: string;
// 	password: string;
// 	organisationName: string;
// }
router.post("/", async (req: Request, res: Response, next: NextFunction) => {
	try {
		const { email, password, organisationName } = req.body;

		// Validating
		if (!email || !password || !organisationName) {
			throw new AppError(400, "Email, Password, and Organisation Name are required");
		}

		// Checking if user already exists
		const existingUserId = await req.app.get("redis").hget(`user:${email}`, "id");
		if (existingUserId) {
			throw new AppError(400, "User already exists");
		}

		// Hashing password and API key
		const apiKey = uuidv4();
		const hashedApiKey = await bcrypt.hash(apiKey, 12);
		const hashedPassword = await bcrypt.hash(password, 12);

		// Creating new user in Redis
		const userId = uuidv4();
		await req.app.get("redis").hset(`user:${email}`, {
			email,
			id: userId,
			organisationName,
			apiKey: hashedApiKey,
			password: hashedPassword,
			createdAt: Date.now().toString(),
		});

		// Sending JWT via a secure cookie
		const token = jwt.sign({ userEmail: email }, process.env.JWT_SECRET || "your-secret-key", {
			expiresIn: "24h",
		});
		res.cookie("token", token, {
			httpOnly: true,
			maxAge: 24 * 60 * 60 * 1000,
			secure: process.env.NODE_ENV === "production",
		});

		res.status(201).json({
			status: "success",
			data: {
				apiKey,
				user: {
					email,
					id: userId,
					organisationName,
				},
			},
		});
	} catch (error) {
		next(error);
	}
});

// GET /users
// Returns user
// Needs valid JWT
router.get("/", authenticateJWT, async (req: Request & { userEmail?: string }, res: Response, next: NextFunction) => {
	try {
		// Find user by email in Redis
		const user = await req.app.get("redis").hgetall(`user:${req.userEmail}`);
		if (Object.keys(user).length === 0) {
			throw new AppError(404, "User not found");
		}

		res.json({
			status: "success",
			data: {
				user: {
					id: user.id,
					email: user.email,
					organisationName: user.organisationName,
				},
			},
		});
	} catch (error) {
		next(error);
	}
});

// PUT /users
// Updates user
// Needs valid JWT
// Request body:
// {
// 	organisationName: string;
// }
router.put("/", authenticateJWT, async (req: Request & { userEmail?: string }, res: Response, next: NextFunction) => {
	try {
		const userEmail = req.userEmail;
		const { organisationName } = req.body;

		const user = await req.app.get("redis").hgetall(`user:${userEmail}`);

		if (Object.keys(user).length === 0) {
			throw new AppError(404, "User not found");
		}

		// Update user
		await req.app.get("redis").hset(`user:${userEmail}`, {
			organisationName: organisationName || user.organisationName,
		});

		res.json({
			status: "success",
			data: {
				user: {
					id: user.id,
					email: user.email,
					organisationName: organisationName || user.organisationName,
				},
			},
		});
	} catch (error) {
		next(error);
	}
});

export const usersRouter = router;
