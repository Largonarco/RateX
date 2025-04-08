import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import express from "express";
import cookieParser from "cookie-parser";

import { connectRedis } from "./utils/redis";

import { authRouter } from "./routes/auth";
import { appsRouter } from "./routes/apps";
import { proxyRouter } from "./routes/proxy";
import { usersRouter } from "./routes/users";
import { errorHandler } from "./middleware/errorHandler";

// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(helmet());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use("/auth", authRouter);
app.use("/apps", appsRouter);
app.use("/apis", proxyRouter);
app.use("/users", usersRouter);

// Error handling
app.use(errorHandler);

// Start server
const startServer = async () => {
	try {
		// Connect to Redis and attach to app
		app.set("redis", await connectRedis());

		app.listen(port, () => {
			console.log(`Server is running on port ${port}`);
		});
	} catch (error) {
		console.error("Failed to start server:", error);
		process.exit(1);
	}
};

startServer();
