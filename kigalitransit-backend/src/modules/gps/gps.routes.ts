import { Router } from 'express';
import * as gpsController from './gps.controller';

export const liveRouter = Router();

liveRouter.get('/positions', gpsController.getPositions);
liveRouter.get('/status', gpsController.getStatus);