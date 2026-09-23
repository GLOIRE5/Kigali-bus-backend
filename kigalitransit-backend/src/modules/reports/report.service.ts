import { createHash } from 'node:crypto';
import { Report, type ReportType } from './report.model';
import * as gtfsService from '../gtfs/gtfs.service';
import { HttpError } from '../../middleware/errorHandler';
import { env } from '../../config/env';

export interface SignalStatus {
  riders: number;
  lastReportedAt: string;
  minutesAgo: number;
}

export interface LineStopStatus {
  routeId: string;
  stopId: string;
  source: 'crowdsourced';
  busHere: SignalStatus | null;
  busFull: SignalStatus | null;
  confidence: 'low' | 'medium' | 'high';
  label: string;
}

export function hashDeviceId(deviceId: string): string {
  return createHash('sha256').update(`${env.DEVICE_HASH_SALT}:${deviceId}`).digest('hex');
}

// Which stops each line serves, cached per GTFS dataset version.
const routeStopsCache = new Map<string, Set<string>>();

async function getStopIdsForRoute(routeId: string): Promise<Set<string>> {
  const dataset = await gtfsService.getActiveDataset();
  const key = `${dataset.version}:${routeId}`;
  const cached = routeStopsCache.get(key);
  if (cached) return cached;

  const stops = await gtfsService.getRouteStops(routeId, 0);
  const stopIds = new Set(stops.map((s) => s.stopId));
  routeStopsCache.set(key, stopIds);
  return stopIds;
}

export async function createReport(input: {
  routeId: string;
  stopId: string;
  reportType: ReportType;
  deviceId: string;
}) {
  const stopIds = await getStopIdsForRoute(input.routeId);
  if (stopIds.size === 0) throw new HttpError(404, `Route ${input.routeId} not found`);
  if (!stopIds.has(input.stopId)) {
    throw new HttpError(400, `Stop ${input.stopId} is not on route ${input.routeId}`);
  }

  const deviceHash = hashDeviceId(input.deviceId);
  const now = Date.now();
  const cooldownMs = env.REPORT_COOLDOWN_SECONDS * 1000;

  // Abuse prevention: one report of each type per device, per line and stop, per cooldown window.
  const recent = await Report.findOne({
    deviceHash,
    routeId: input.routeId,
    stopId: input.stopId,
    reportType: input.reportType,
    createdAt: { $gte: new Date(now - cooldownMs) },
  })
    .sort({ createdAt: -1 })
    .lean();

  if (recent) {
    const retryAfter = Math.max(1, Math.ceil((new Date(recent.createdAt).getTime() + cooldownMs - now) / 1000));
    throw new HttpError(429, `You already sent this report. You can report again in ${retryAfter} seconds.`);
  }

  const report = await Report.create({
    routeId: input.routeId,
    stopId: input.stopId,
    reportType: input.reportType,
    deviceHash,
    createdAt: new Date(now),
    expiresAt: new Date(now + env.REPORT_TTL_MINUTES * 60 * 1000),
  });

  return {
    id: String(report._id),
    routeId: report.routeId,
    stopId: report.stopId,
    reportType: report.reportType,
    createdAt: report.createdAt,
    expiresAt: report.expiresAt,
  };
}

function toSignal(devices: string[], lastReportedAt: Date, now: number): SignalStatus {
  return {
    riders: devices.length,
    lastReportedAt: lastReportedAt.toISOString(),
    minutesAgo: Math.max(0, Math.round((now - lastReportedAt.getTime()) / 60000)),
  };
}

function confidenceFor(riders: number): LineStopStatus['confidence'] {
  if (riders >= 3) return 'high';
  if (riders === 2) return 'medium';
  return 'low';
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function buildLabel(busHere: SignalStatus | null, busFull: SignalStatus | null): string {
  const parts: string[] = [];
  if (busHere) parts.push(`${plural(busHere.riders, 'rider')} confirmed the bus here (latest ${busHere.minutesAgo} min ago)`);
  if (busFull) parts.push(`${plural(busFull.riders, 'rider')} reported it full`);
  return `Rider-reported: ${parts.join('; ')}`;
}

function latestTime(status: LineStopStatus): number {
  return Math.max(
    status.busHere ? Date.parse(status.busHere.lastReportedAt) : 0,
    status.busFull ? Date.parse(status.busFull.lastReportedAt) : 0
  );
}

interface ReportGroup {
  _id: { routeId: string; stopId: string; reportType: ReportType };
  devices: string[];
  lastReportedAt: Date;
}

export async function getStatus(filter: { routeId?: string; stopId?: string; windowMinutes?: number }) {
  const windowMinutes = Math.min(filter.windowMinutes ?? env.REPORT_TTL_MINUTES, env.REPORT_TTL_MINUTES);
  const now = Date.now();

  const match: Record<string, unknown> = { createdAt: { $gte: new Date(now - windowMinutes * 60000) } };
  if (filter.routeId) match.routeId = filter.routeId;
  if (filter.stopId) match.stopId = filter.stopId;

  const groups = await Report.aggregate<ReportGroup>([
    { $match: match },
    {
      $group: {
        _id: { routeId: '$routeId', stopId: '$stopId', reportType: '$reportType' },
        devices: { $addToSet: '$deviceHash' }, // unique riders, not raw taps
        lastReportedAt: { $max: '$createdAt' },
      },
    },
  ]);

  const byLineStop = new Map<string, LineStopStatus>();
  for (const group of groups) {
    const key = `${group._id.routeId}|${group._id.stopId}`;
    let entry = byLineStop.get(key);
    if (!entry) {
      entry = {
        routeId: group._id.routeId,
        stopId: group._id.stopId,
        source: 'crowdsourced',
        busHere: null,
        busFull: null,
        confidence: 'low',
        label: '',
      };
      byLineStop.set(key, entry);
    }
    const signal = toSignal(group.devices, group.lastReportedAt, now);
    if (group._id.reportType === 'BUS_HERE') entry.busHere = signal;
    else entry.busFull = signal;
  }

  const results = [...byLineStop.values()]
    .map((entry) => {
      const riders = Math.max(entry.busHere?.riders ?? 0, entry.busFull?.riders ?? 0);
      return { ...entry, confidence: confidenceFor(riders), label: buildLabel(entry.busHere, entry.busFull) };
    })
    .sort((a, b) => latestTime(b) - latestTime(a));

  return {
    source: 'crowdsourced' as const,
    windowMinutes,
    generatedAt: new Date(now).toISOString(),
    results,
  };
}