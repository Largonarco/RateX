import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { authenticateJWT } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { Router, Request, Response, NextFunction } from "express";

const router = Router();

// POST /auth/login
// Logs in user
// Request body:
// {
// 	email: string;
// 	password: string;
// }
router.post("/login", async (req: Request, res: Response, next: NextFunction) => {
	try {
		const { email, password } = req.body;

		// Validating
		if (!email || !password) {
			throw new AppError(400, "Email and Password are required");
		}

		// Checking if user already exists
		const existingUser = await req.app.get("redis").hgetall(`user:${email}`);
		if (Object.keys(existingUser).length === 0) {
			throw new AppError(400, "Invalid Email");
		}

		// Checking password
		const isValidPassword = await bcrypt.compare(password, existingUser.password);
		if (!isValidPassword) {
			throw new AppError(401, "Invalid Password");
		}

		// Sending JWT via cookie
		const token = jwt.sign({ userEmail: existingUser.email }, process.env.JWT_SECRET || "your-secret-key", {
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
				message: "Logged in successfully",
			},
		});
	} catch (error) {
		next(error);
	}
});

// GET /auth/refresh
// Refreshes token
// Needs JWT to refresh JWT
router.get(
	"/refresh",
	authenticateJWT,
	async (req: Request & { userEmail?: string }, res: Response, next: NextFunction) => {
		try {
			// Sending new JWT via cookie
			const token = jwt.sign({ userEmail: req.userEmail }, process.env.JWT_SECRET || "your-secret-key", {
				expiresIn: "24h",
			});
			res.cookie("token", token, {
				httpOnly: true,
				maxAge: 24 * 60 * 60 * 1000,
				secure: process.env.NODE_ENV === "production",
			});

			res.status(200).json({
				status: "success",
				data: {
					message: "Token refreshed successfully",
				},
			});
		} catch (error) {
			next(error);
		}
	}
);

// GET /auth/logout
// Logs out user
// Needs JWT to clear JWT
router.get(
	"/logout",
	authenticateJWT,
	async (req: Request & { userEmail?: string }, res: Response, next: NextFunction) => {
		try {
			res.clearCookie("token");
			res.status(200).json({
				status: "success",
				data: {
					message: "Logged out successfully",
				},
			});
		} catch (error) {
			next(error);
		}
	}
);

export const authRouter = router;
