import bcrypt from "bcryptjs";
import mongoose, { Document, Schema } from "mongoose";

export interface IUser extends Document {
	email: string;
	apiKey: string;
	createdAt: Date;
	password: string;
	organisationName: string;
	apps: mongoose.Types.ObjectId[];
	compareAPIKey(candidateAPIKey: string): Promise<boolean>;
	comparePassword(candidatePassword: string): Promise<boolean>;
}

const userSchema = new Schema<IUser>({
	_id: {
		type: mongoose.Schema.Types.ObjectId,
		required: true,
	},
	email: {
		trim: true,
		unique: true,
		type: String,
		required: true,
		lowercase: true,
	},
	password: {
		minlength: 6,
		type: String,
		required: true,
	},
	apiKey: {
		unique: true,
		type: String,
		required: true,
	},
	organisationName: {
		trim: true,
		type: String,
		required: true,
	},
	createdAt: {
		type: Date,
		default: Date.now,
	},
	apps: {
		default: [],
		ref: "App",
		type: [mongoose.Schema.Types.ObjectId],
	},
});

// Hash password before saving
userSchema.pre("save", async function (next) {
	if (!this.isModified("password")) return next();

	try {
		const salt = await bcrypt.genSalt(12);
		this.password = await bcrypt.hash(this.password, salt);
		next();
	} catch (error) {
		next(error as Error);
	}
});

// Method to compare passwords
userSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
	return bcrypt.compare(candidatePassword, this.password);
};

// Method to compare API keys
userSchema.methods.compareAPIKey = async function (candidateAPIKey: string): Promise<boolean> {
	return bcrypt.compare(candidateAPIKey, this.apiKey);
};

export const User = mongoose.model<IUser>("User", userSchema);
