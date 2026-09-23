import { env } from '../../config/env';
import type { GpsPosition, GpsProvider } from './gps.types';
import { MockGpsProvider } from './mockGpsProvider';
import * as gtfsService from '../gtfs/gtfs.service';
import type { RouteStopDto } from '../gtfs/gtfs.service';
import * as reportService from '../reports/report.service';
import type { LineStopStatus } from '../reports/report.service';
import { haversineMeters } from '../../utils/geo';
import { HttpError } from '../../middleware/errorHandler';

// ---- Provider selection: the ONLY place that knows which GPS source is used ----
function createProvider(): GpsProvider {
  switch (env.GPS_PROVIDER) {
    case 'mock':
      return new MockGpsProvider();
    case 'rura':
      throw new Error(
        'GPS_PROVIDER=rura is not implemented yet. Create a class that implements GpsProvider (see gps.types.ts) and return it here.'
      );
  }
}

const provider = createProvider();

export interface LivePosition extends GpsPosition {
  ageSeconds: number;
  stale: boolean;
}

export interface NextArrival {
  busId: string;
  directionId: 0 | 1;
  headsign: string; // where this bus is going, e.g. "Kacyiru"
  etaMinutes: number;
  distanceMeters: number;
}

export type LiveSource = 'official_gps' | 'crowdsourced' | 'none';

export interface LineLiveStatus {
  routeId: string;
  stopId: string | null;
  primarySource: LiveSource;
  label: string;
  gps: {
    provider: string;
    busesTracked: number;
    staleBuses: number;
    nextArrivals: NextArrival[];
  };
  crowdsourced: LineStopStatus[];
}

// ETA assumptions match the timetable generator (approximate on purpose - Kigali hills and traffic)
const ETA_SPEED_KMH = 18;
const ETA_DETOUR_FACTOR = 1.3;
const ETA_DWELL_MINUTES = 1;
const AT_STOP_METERS = 60;
const ARRIVALS_PER_DIRECTION = 2;

const routeStopsCache = new Map<string, RouteStopDto[]>();
let stopRoutesCache: { version: string; map: Map<string, string[]> } | null = null;

async function getRouteStopsCached(routeId: string, directionId: 0 | 1): Promise<RouteStopDto[]> {
  const { version } = await gtfsService.getActiveDataset();
  const key = `${version}:${routeId}:${directionId}`;
  const cached = routeStopsCache.get(key);
  if (cached) return cached;
  const stops = await gtfsService.getRouteStops(routeId, directionId);
  routeStopsCache.set(key, stops);
  return stops;
}

async function routesServingStop(stopId: string): Promise<string[]> {
  const bundle = await gtfsService.getBundle();
  let cache = stopRoutesCache;

  if (!cache || cache.version !== bundle.version) {
    const routeByTrip = new Map(bundle.trips.map((t) => [t.trip_id, t.route_id]));
    const sets = new Map<string, Set<string>>();
    for (const st of bundle.stop_times) {
      const routeId = routeByTrip.get(st.trip_id);
      if (!routeId) continue;
      const set = sets.get(st.stop_id) ?? new Set<string>();
      set.add(routeId);
      sets.set(st.stop_id, set);
    }
    cache = {
      version: bundle.version,
      map: new Map([...sets].map(([id, routes]) => [id, [...routes].sort()])),
    };
    stopRoutesCache = cache;
  }

  return cache.map.get(stopId) ?? [];
}

/** Works from position only, so it will also work with a real RURA feed. */
async function estimateArrival(bus: GpsPosition, stopId: string) {
  const stops = await getRouteStopsCached(bus.routeId, bus.directionId);
  const targetIndex = stops.findIndex((s) => s.stopId === stopId);

  // Not on this direction, or it is the final stop (bus ends there - nobody can board it onward)
  if (targetIndex === -1 || targetIndex === stops.length - 1) return null;

  const headsign = stops[stops.length - 1]?.name ?? '';
  const target = stops[targetIndex]!;

  if (bus.speedKmh === 0 && haversineMeters(bus.lat, bus.lng, target.lat, target.lng) <= AT_STOP_METERS) {
    return { headsign, etaMinutes: 0, distanceMeters: 0 }; // bus is at the stop right now
  }

  const nextIndex = bus.nextStopId ? stops.findIndex((s) => s.stopId === bus.nextStopId) : -1;
  if (nextIndex === -1 || targetIndex < nextIndex) return null; // already passed this stop

  const nextStop = stops[nextIndex]!;
  let meters = haversineMeters(bus.lat, bus.lng, nextStop.lat, nextStop.lng);
  for (let i = nextIndex; i < targetIndex; i++) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    meters += haversineMeters(a.lat, a.lng, b.lat, b.lng);
  }

  const roadMeters = meters * ETA_DETOUR_FACTOR;
  const minutes = (roadMeters / 1000 / ETA_SPEED_KMH) * 60 + (targetIndex - nextIndex) * ETA_DWELL_MINUTES;
  return { headsign, etaMinutes: Math.max(1, Math.round(minutes)), distanceMeters: Math.round(roadMeters) };
}

export async function getLivePositions(routeId?: string, at?: Date) {
  const reference = at ?? new Date();
  const raw = await provider.getPositions({ routeId, at });

  const positions: LivePosition[] = raw.map((p) => {
    const ageSeconds = Math.max(0, Math.round((reference.getTime() - Date.parse(p.lastUpdated)) / 1000));
    return { ...p, ageSeconds, stale: ageSeconds > env.GPS_STALE_SECONDS };
  });

  return { provider: provider.name, generatedAt: reference.toISOString(), positions };
}

function busWord(count: number): string {
  return `${count} ${count === 1 ? 'bus' : 'buses'}`;
}

/** Soonest bus in each direction, soonest direction first. */
function soonestPerDirection(arrivals: NextArrival[]): NextArrival[] {
  const byDirection = new Map<number, NextArrival>();
  for (const arrival of arrivals) {
    if (!byDirection.has(arrival.directionId)) byDirection.set(arrival.directionId, arrival);
  }
  return [...byDirection.values()];
}

function buildLabel(
  source: LiveSource,
  busCount: number,
  arrivals: NextArrival[],
  crowd: LineStopStatus[],
  hasStop: boolean
): string {
  const crowdLabel = crowd[0]?.label;

  if (source === 'official_gps') {
    let text: string;
    const soonest = soonestPerDirection(arrivals);

    if (hasStop && soonest.length > 0) {
      const parts = soonest.map((a) =>
        a.etaMinutes === 0 ? `to ${a.headsign}: at this stop now` : `to ${a.headsign}: ~${a.etaMinutes} min`
      );
      text = `Live GPS - next bus ${parts.join('; ')}`;
    } else if (hasStop) {
      text = `Live GPS: ${busWord(busCount)} on this line, none heading to this stop right now`;
    } else {
      text = `Live GPS: ${busWord(busCount)} tracked on this line`;
    }
    // GPS is primary, but rider reports stay visible as a second confirmation
    return crowdLabel ? `${text} | ${crowdLabel}` : text;
  }

  if (source === 'crowdsourced') {
    return `No live GPS for this line right now. ${crowdLabel ?? ''}`.trim();
  }

  return 'No live data right now. Showing the timetable estimate.';
}

export async function getLiveStatus(input: { routeId?: string; stopId?: string; at?: Date }) {
  const { routeId, stopId, at } = input;

  let routeIds: string[];
  if (routeId) {
    const routes = await gtfsService.listRoutes();
    if (!routes.some((r) => r.routeId === routeId)) throw new HttpError(404, `Route ${routeId} not found`);
    routeIds = [routeId];
  } else {
    routeIds = await routesServingStop(stopId ?? '');
    if (routeIds.length === 0) throw new HttpError(404, `No routes serve stop ${stopId}`);
  }

  const [live, crowd] = await Promise.all([
    getLivePositions(routeId, at),
    reportService.getStatus({ routeId, stopId }),
  ]);

  const results: LineLiveStatus[] = [];

  for (const rid of routeIds) {
    const onRoute = live.positions.filter((p) => p.routeId === rid);
    const fresh = onRoute.filter((p) => !p.stale);
    const crowdReports = crowd.results.filter((r) => r.routeId === rid);

    const arrivals: NextArrival[] = [];
    if (stopId) {
      for (const bus of fresh) {
        const estimate = await estimateArrival(bus, stopId);
        if (estimate) arrivals.push({ busId: bus.busId, directionId: bus.directionId, ...estimate });
      }
      arrivals.sort((a, b) => a.etaMinutes - b.etaMinutes);
    }

    // Keep the next few buses in EACH direction so riders see their own direction
    const perDirectionCount = new Map<number, number>();
    const nextArrivals = arrivals.filter((a) => {
      const count = perDirectionCount.get(a.directionId) ?? 0;
      perDirectionCount.set(a.directionId, count + 1);
      return count < ARRIVALS_PER_DIRECTION;
    });

    // Reconciliation: fresh GPS wins; otherwise riders; otherwise tell the app to use its timetable
    const primarySource: LiveSource =
      fresh.length > 0 ? 'official_gps' : crowdReports.length > 0 ? 'crowdsourced' : 'none';

    results.push({
      routeId: rid,
      stopId: stopId ?? null,
      primarySource,
      label: buildLabel(primarySource, fresh.length, nextArrivals, crowdReports, Boolean(stopId)),
      gps: {
        provider: live.provider,
        busesTracked: fresh.length,
        staleBuses: onRoute.length - fresh.length,
        nextArrivals,
      },
      crowdsourced: crowdReports,
    });
  }

  return { generatedAt: live.generatedAt, results };
}