import { Router } from 'express';
import * as gtfsController from './gtfs.controller';

export const gtfsRouter = Router();

gtfsRouter.get('/version', gtfsController.getVersion);
gtfsRouter.get('/bundle', gtfsController.getBundle);
gtfsRouter.get('/stops', gtfsController.searchStops);
gtfsRouter.get('/stops/nearby', gtfsController.nearbyStops);
gtfsRouter.get('/routes', gtfsController.listRoutes);
gtfsRouter.get('/routes/:routeId', gtfsController.getRoute);