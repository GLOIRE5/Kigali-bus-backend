import { Stop, GtfsRoute, Trip, StopTime, GtfsDataset } from './gtfs.models';
import { HttpError } from '../../middleware/errorHandler';
import { haversineMeters } from '../../utils/geo';
import { gtfsTimeToMinutes } from '../../utils/time';

export interface StopDto {
  stopId: string;
  name: string;
  aliases: string[];
  lat: number;
  lng: number;
}

export interface RouteStopDto extends StopDto {
  stopSequence: number;
  minutesFromStart: number;
}

// Field names follow the GTFS standard so the mobile app can load them straight into SQLite.
export interface GtfsBundle {
  version: string;
  publishedAt: string;
  stops: Array<{ stop_id: string; stop_name: string; stop_lat: number; stop_lon: number; aliases: string[] }>;
  routes: Array<{ route_id: string; route_short_name: string; route_long_name: string; route_type: number; route_color: string }>;
  trips: Array<{ trip_id: string; route_id: string; service_id: string; trip_headsign: string; direction_id: number }>;
  stop_times: Array<{ trip_id: string; arrival_time: string; departure_time: string; stop_id: string; stop_sequence: number }>;
}

interface StopLike {
  stopId: string;
  name: string;
  aliases: string[];
  location: { coordinates: number[] };
}

function toStopDto(stop: StopLike): StopDto {
  const [lng = 0, lat = 0] = stop.location.coordinates;
  return { stopId: stop.stopId, name: stop.name, aliases: [...stop.aliases], lat, lng };
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The bundle is built once per dataset version and kept in memory.
let bundleCache: GtfsBundle | null = null;

export async function getActiveDataset() {
  const dataset = await GtfsDataset.findOne({ isActive: true }).lean();
  if (!dataset) {
    throw new HttpError(503, 'No GTFS dataset loaded yet. Run: npm run seed');
  }
  return dataset;
}

export async function getBundle(): Promise<GtfsBundle> {
  const dataset = await getActiveDataset();
  if (bundleCache && bundleCache.version === dataset.version) return bundleCache;

  const [stops, routes, trips, stopTimes] = await Promise.all([
    Stop.find().sort({ stopId: 1 }).lean(),
    GtfsRoute.find().sort({ routeId: 1 }).lean(),
    Trip.find().sort({ tripId: 1 }).lean(),
    StopTime.find().sort({ tripId: 1, stopSequence: 1 }).lean(),
  ]);

  bundleCache = {
    version: dataset.version,
    publishedAt: new Date(dataset.publishedAt).toISOString(),
    stops: stops.map((s) => {
      const dto = toStopDto(s);
      return { stop_id: dto.stopId, stop_name: dto.name, stop_lat: dto.lat, stop_lon: dto.lng, aliases: dto.aliases };
    }),
    routes: routes.map((r) => ({
      route_id: r.routeId,
      route_short_name: r.shortName,
      route_long_name: r.longName,
      route_type: r.routeType,
      route_color: r.color,
    })),
    trips: trips.map((t) => ({
      trip_id: t.tripId,
      route_id: t.routeId,
      service_id: t.serviceId,
      trip_headsign: t.headsign,
      direction_id: t.directionId,
    })),
    stop_times: stopTimes.map((st) => ({
      trip_id: st.tripId,
      arrival_time: st.arrivalTime,
      departure_time: st.departureTime,
      stop_id: st.stopId,
      stop_sequence: st.stopSequence,
    })),
  };

  return bundleCache;
}

/** Partial, case-insensitive match on official name and informal aliases. */
export async function searchStops(query: string, limit: number): Promise<StopDto[]> {
  const regex = new RegExp(escapeRegex(query.trim()), 'i');
  const stops = await Stop.find({ $or: [{ name: regex }, { aliases: regex }] })
    .sort({ name: 1 })
    .limit(limit)
    .lean();
  return stops.map(toStopDto);
}

export async function findNearbyStops(lat: number, lng: number, radiusMeters: number, limit: number) {
  const stops = await Stop.find({
    location: {
      $near: {
        $geometry: { type: 'Point', coordinates: [lng, lat] },
        $maxDistance: radiusMeters,
      },
    },
  })
    .limit(limit)
    .lean();

  return stops.map((s) => {
    const dto = toStopDto(s);
    return { ...dto, distanceMeters: Math.round(haversineMeters(lat, lng, dto.lat, dto.lng)) };
  });
}

export async function listRoutes() {
  const routes = await GtfsRoute.find().sort({ routeId: 1 }).lean();
  return routes.map((r) => ({
    routeId: r.routeId,
    shortName: r.shortName,
    longName: r.longName,
    routeType: r.routeType,
    color: r.color,
  }));
}

/** Ordered stops of a line in one direction, with typical minutes from the first stop. */
export async function getRouteStops(routeId: string, directionId: 0 | 1): Promise<RouteStopDto[]> {
  const trip = await Trip.findOne({ routeId, directionId }).sort({ tripId: 1 }).lean();
  if (!trip) return [];

  const stopTimes = await StopTime.find({ tripId: trip.tripId }).sort({ stopSequence: 1 }).lean();
  const first = stopTimes[0];
  if (!first) return [];

  const stops = await Stop.find({ stopId: { $in: stopTimes.map((st) => st.stopId) } }).lean();
  const stopById = new Map(stops.map((s) => [s.stopId, s]));
  const startMinutes = gtfsTimeToMinutes(first.departureTime);

  const result: RouteStopDto[] = [];
  for (const st of stopTimes) {
    const stop = stopById.get(st.stopId);
    if (!stop) continue;
    result.push({
      ...toStopDto(stop),
      stopSequence: st.stopSequence,
      minutesFromStart: gtfsTimeToMinutes(st.arrivalTime) - startMinutes,
    });
  }
  return result;
}

export async function getRouteDetail(routeId: string) {
  const route = await GtfsRoute.findOne({ routeId }).lean();
  if (!route) throw new HttpError(404, `Route ${routeId} not found`);

  const directions = await Promise.all(
    ([0, 1] as const).map(async (directionId) => {
      const trip = await Trip.findOne({ routeId, directionId }).lean();
      return {
        directionId,
        headsign: trip?.headsign ?? null,
        stops: await getRouteStops(routeId, directionId),
      };
    })
  );

  return {
    routeId: route.routeId,
    shortName: route.shortName,
    longName: route.longName,
    color: route.color,
    directions,
  };
}