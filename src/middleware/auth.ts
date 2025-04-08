import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { AppError } from "./errorHandler";

export const authenticateAPIKey = async (req: Request & { userEmail?: string }, res: Response, next: NextFunction) => {
	try {
		// Get API key from Authorization header
		const apiKey = req.headers["authorization"]?.split(" ") || [];
		if (apiKey[0] !== "Bearer" || !apiKey[1]) {
			throw new AppError(401, "API key is required");
		}

		if (!req.userEmail) {
			throw new AppError(401, "User not authenticated");
		}

		// Checking if API key is valid
		const apiKeyHash = await req.app.get("redis").hget(`user:${req.userEmail}`, "apiKey");
		const isAPIKeyValid = await bcrypt.compare(apiKey[1], apiKeyHash || "");
		if (!isAPIKeyValid) {
			throw new AppError(401, "Invalid API key");
		}

		next();
	} catch (error) {
		next(error);
	}
};

// Authenticate JWT from cookie
export const authenticateJWT = async (req: Request & { userEmail?: string }, res: Response, next: NextFunction) => {
	try {
		const token = req.cookies.token;
		if (!token) {
			throw new AppError(401, "Not authenticated");
		}

		// Verifying JWT
		const decoded = jwt.verify(token, process.env.JWT_SECRET || "your-secret-key") as { userEmail: string };

		// Finding user by email
		const userEmail = await req.app.get("redis").hget(`user:${decoded.userEmail}`, "email");
		if (!userEmail) {
			throw new AppError(401, "Not authenticated");
		}

		// Attaching user email to request
		req.userEmail = userEmail;

		next();
	} catch (error) {
		next(error);
	}
};
