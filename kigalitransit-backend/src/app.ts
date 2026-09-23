import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import mongoose from 'mongoose';
import { env } from './config/env';
import { notFound, errorHandler } from './middleware/errorHandler';
import { gtfsRouter } from './modules/gtfs/gtfs.routes';
import { reportsRouter } from './modules/reports/report.routes';
import { liveRouter } from './modules/gps/gps.routes';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',') }));
  app.use(compression()); // gzip: keeps downloads small for riders on limited data bundles
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/api/gtfs', gtfsRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/live', liveRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}