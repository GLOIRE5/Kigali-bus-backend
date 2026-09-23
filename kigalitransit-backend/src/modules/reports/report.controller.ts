import type { Request, Response } from 'express';
import { z } from 'zod';
import * as reportService from './report.service';
import { REPORT_TYPES } from './report.model';
import { parseOrThrow } from '../../utils/validate';
import { HttpError } from '../../middleware/errorHandler';

const createReportBody = z.object({
  routeId: z.string().trim().min(1).max(50),
  stopId: z.string().trim().min(1).max(50),
  reportType: z.enum(REPORT_TYPES),
});

export async function createReport(req: Request, res: Response) {
  const deviceId = req.get('x-device-id')?.trim();
  if (!deviceId || deviceId.length < 8 || deviceId.length > 100) {
    throw new HttpError(400, 'Missing or invalid X-Device-Id header (8-100 characters)');
  }

  const body = parseOrThrow(createReportBody, req.body);
  const report = await reportService.createReport({ ...body, deviceId });
  res.status(201).json(report);
}

const statusQuery = z
  .object({
    routeId: z.string().trim().min(1).max(50).optional(),
    stopId: z.string().trim().min(1).max(50).optional(),
    windowMinutes: z.coerce.number().int().min(1).max(60).optional(),
  })
  .refine((q) => Boolean(q.routeId || q.stopId), { message: 'Provide routeId, stopId, or both' });

export async function getStatus(req: Request, res: Response) {
  const query = parseOrThrow(statusQuery, req.query);
  res.json(await reportService.getStatus(query));
}