import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import express from "express";
import { v4 as uuidv4 } from "uuid";
import cookieParser from "cookie-parser";

import { connectRedis } from "./db/redis";
import { WorkerManager } from "./worker/manager";

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

// Graceful shutdown
const shutdownServer = async () => {
	// Stop accepting new requests
	await new Promise<void>((resolve) => {
		app.get("server").close(() => {
			console.log("HTTP server closed");
			resolve();
		});
	});
	// Close Redis connection
	await app.get("redis").quit();
	// Shutdown worker manager
	await app.get("workerManager").shutdown();

	// Exit process
	process.exit(0);
};

// Start server
const startServer = async () => {
	try {
		// Connect to Redis
		const redis = await connectRedis();
		// Get or create server ID
		const serverId = await WorkerManager.getAvailableServerId(redis);
		// Start worker manager with server ID
		const workerManager = new WorkerManager(redis, serverId);
		workerManager.start();

		// Start server
		const server = app.listen(port, () => {
			console.log(`Server is running on port ${port} with ID ${serverId}`);
		});

		// Set values as app properties
		app.set("redis", redis);
		app.set("server", server);
		app.set("serverId", serverId);
		app.set("workerManager", workerManager);

		// Handle shutdown signals
		process.on("SIGINT", shutdownServer);
		process.on("SIGTERM", shutdownServer);
	} catch (error) {
		console.error("Failed to start server:", error);
		process.exit(1);
	}
};

startServer();
