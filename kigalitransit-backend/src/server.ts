import { createApp } from './app';
import { connectDB, disconnectDB } from './config/db';
import { env } from './config/env';

async function main() {
  await connectDB();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(`KigaliTransit API running on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });

  const shutdown = async (signal: string) => {
    console.log(`${signal} received, shutting down...`);
    server.close();
    await disconnectDB();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});