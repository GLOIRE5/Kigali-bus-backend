import { Router } from 'express';
import * as reportController from './report.controller';
import { reportWriteLimiter } from '../../middleware/rateLimit';

export const reportsRouter = Router();

reportsRouter.post('/', reportWriteLimiter, reportController.createReport);
reportsRouter.get('/status', reportController.getStatus);