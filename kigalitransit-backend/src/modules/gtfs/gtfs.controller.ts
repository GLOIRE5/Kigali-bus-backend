import type { Request, Response } from 'express';
import { z } from 'zod';
import * as gtfsService from './gtfs.service';
import { parseOrThrow } from '../../utils/validate';

export async function getVersion(_req: Request, res: Response) {
  const dataset = await gtfsService.getActiveDataset();
  res.json({
    version: dataset.version,
    publishedAt: dataset.publishedAt,
    counts: dataset.counts,
  });
}

const bundleQuery = z.object({
  currentVersion: z.string().max(100).optional(),
});

export async function getBundle(req: Request, res: Response) {
  const { currentVersion } = parseOrThrow(bundleQuery, req.query);
  const dataset = await gtfsService.getActiveDataset();

  // The app already has this version: send a tiny response instead of the full dataset.
  if (currentVersion === dataset.version) {
    res.json({ upToDate: true, version: dataset.version });
    return;
  }

  const bundle = await gtfsService.getBundle();
  res.set('Cache-Control', 'no-cache');
  res.json({ upToDate: false, ...bundle });
}

const searchQuery = z.object({
  q: z.string().trim().min(1).max(50),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export async function searchStops(req: Request, res: Response) {
  const { q, limit } = parseOrThrow(searchQuery, req.query);
  res.json({ results: await gtfsService.searchStops(q, limit) });
}

const nearbyQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().int().min(50).max(5000).default(500),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export async function nearbyStops(req: Request, res: Response) {
  const { lat, lng, radius, limit } = parseOrThrow(nearbyQuery, req.query);
  res.json({ results: await gtfsService.findNearbyStops(lat, lng, radius, limit) });
}

export async function listRoutes(_req: Request, res: Response) {
  res.json({ results: await gtfsService.listRoutes() });
}

const routeParams = z.object({
  routeId: z.string().min(1).max(50),
});

export async function getRoute(req: Request, res: Response) {
  const { routeId } = parseOrThrow(routeParams, req.params);
  res.json(await gtfsService.getRouteDetail(routeId));
}