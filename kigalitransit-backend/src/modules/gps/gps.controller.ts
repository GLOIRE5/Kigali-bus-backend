import type { Request, Response } from 'express';
import { z } from 'zod';
import * as gpsService from './gps.service';
import { parseOrThrow } from '../../utils/validate';
import { HttpError } from '../../middleware/errorHandler';
import { env } from '../../config/env';
import { kigaliMinutesOfDay } from '../../utils/time';

const simulatedTimeParam = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM in Kigali time, e.g. 08:15')
  .optional();

/** Development helper: turn "08:15" (Kigali time, today) into a Date. */
function resolveSimulatedTime(value?: string): Date | undefined {
  if (!value) return undefined;
  if (env.NODE_ENV === 'production') {
    throw new HttpError(400, 'simulatedTime is only available in development');
  }
  const [hours = 0, minutes = 0] = value.split(':').map(Number);
  const now = new Date();
  const diffMinutes = hours * 60 + minutes - kigaliMinutesOfDay(now);
  return new Date(now.getTime() + diffMinutes * 60000);
}

const positionsQuery = z.object({
  routeId: z.string().trim().min(1).max(50).optional(),
  simulatedTime: simulatedTimeParam,
});

export async function getPositions(req: Request, res: Response) {
  const query = parseOrThrow(positionsQuery, req.query);
  const at = resolveSimulatedTime(query.simulatedTime);
  res.json(await gpsService.getLivePositions(query.routeId, at));
}

const statusQuery = z
  .object({
    routeId: z.string().trim().min(1).max(50).optional(),
    stopId: z.string().trim().min(1).max(50).optional(),
    simulatedTime: simulatedTimeParam,
  })
  .refine((q) => Boolean(q.routeId || q.stopId), { message: 'Provide routeId, stopId, or both' });

export async function getStatus(req: Request, res: Response) {
  const query = parseOrThrow(statusQuery, req.query);
  const at = resolveSimulatedTime(query.simulatedTime);
  res.json(await gpsService.getLiveStatus({ routeId: query.routeId, stopId: query.stopId, at }));
}