import mongoose from 'mongoose';
import { env } from './env';

export async function connectDB(): Promise<void> {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.MONGODB_URI);
  console.log(`MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
  console.log('MongoDB disconnected');
}