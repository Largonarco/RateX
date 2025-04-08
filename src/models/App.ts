import mongoose, { Document, Schema } from "mongoose";

export interface IRateLimit {
	window: number;
	requests: number;
	strategy: "fixed_window" | "sliding_window" | "token_bucket";
}

export interface IApp extends Document {
	name: string;
	baseUrl: string;
	createdAt: Date;
	rateLimit: IRateLimit;
	userId: mongoose.Types.ObjectId;
}

const rateLimitSchema = new Schema<IRateLimit>({
	strategy: {
		type: String,
		required: true,
		enum: ["fixed_window", "sliding_window", "token_bucket"],
	},
	requests: {
		type: Number,
		required: true,
		min: 1,
	},
	window: {
		type: Number,
		required: true,
		min: 1,
	},
});

const appSchema = new Schema<IApp>({
	userId: {
		type: Schema.Types.ObjectId,
		ref: "User",
		required: true,
	},
	name: {
		type: String,
		required: true,
		trim: true,
	},
	baseUrl: {
		type: String,
		required: true,
		trim: true,
	},
	rateLimit: {
		type: rateLimitSchema,
		required: true,
	},
	createdAt: {
		type: Date,
		default: Date.now,
	},
});

export const App = mongoose.model<IApp>("App", appSchema);
