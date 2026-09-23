import { createHash } from 'node:crypto';
import { connectDB, disconnectDB } from '../src/config/db';
import { Stop, GtfsRoute, Trip, StopTime, GtfsDataset } from '../src/modules/gtfs/gtfs.models';
import { haversineMeters } from '../src/utils/geo';
import { minutesToGtfsTime } from '../src/utils/time';
import { STOPS, ROUTES, SERVICE_START_MINUTES, SERVICE_END_MINUTES, type SeedStop } from './kigaliData';

const AVG_SPEED_KMH = 18; // Kigali traffic + hills
const DETOUR_FACTOR = 1.3; // roads are not straight lines
const DWELL_MINUTES = 1; // time the bus waits at each stop

interface TripSeed {
  tripId: string;
  routeId: string;
  serviceId: string;
  headsign: string;
  directionId: 0 | 1;
}

interface StopTimeSeed {
  tripId: string;
  stopId: string;
  stopSequence: number;
  arrivalTime: string;
  departureTime: string;
}

function segmentMinutes(from: SeedStop, to: SeedStop): number {
  const meters = haversineMeters(from.lat, from.lng, to.lat, to.lng) * DETOUR_FACTOR;
  return Math.max(2, Math.round((meters / 1000 / AVG_SPEED_KMH) * 60));
}

function buildTimetable() {
  const stopById = new Map(STOPS.map((s) => [s.stopId, s]));
  const trips: TripSeed[] = [];
  const stopTimes: StopTimeSeed[] = [];

  for (const route of ROUTES) {
    for (const stopId of route.stopIds) {
      if (!stopById.has(stopId)) throw new Error(`Route ${route.routeId} uses unknown stop ${stopId}`);
    }

    for (const directionId of [0, 1] as const) {
      const ids = directionId === 0 ? route.stopIds : [...route.stopIds].reverse();
      const lastStop = stopById.get(ids[ids.length - 1]!)!;
      let tripNumber = 0;

      for (let start = SERVICE_START_MINUTES; start <= SERVICE_END_MINUTES; start += route.headwayMinutes) {
        tripNumber++;
        const tripId = `${route.routeId}_${directionId}_${String(tripNumber).padStart(3, '0')}`;
        trips.push({ tripId, routeId: route.routeId, serviceId: 'DAILY', headsign: lastStop.name, directionId });

        let clock = start;
        ids.forEach((stopId, index) => {
          if (index > 0) clock += segmentMinutes(stopById.get(ids[index - 1]!)!, stopById.get(stopId)!);
          const isTerminal = index === 0 || index === ids.length - 1;
          const arrival = clock;
          const departure = isTerminal ? clock : clock + DWELL_MINUTES;
          stopTimes.push({
            tripId,
            stopId,
            stopSequence: index + 1,
            arrivalTime: minutesToGtfsTime(arrival),
            departureTime: minutesToGtfsTime(departure),
          });
          clock = departure;
        });
      }
    }
  }

  return { trips, stopTimes };
}

async function main() {
  await connectDB();

  const { trips, stopTimes } = buildTimetable();

  // Same data always gives the same version, so apps don't re-download unchanged data.
  const hash = createHash('sha256')
    .update(JSON.stringify({ STOPS, ROUTES, trips, stopTimes }))
    .digest('hex')
    .slice(0, 12);
  const version = `kigali-mock-${hash}`;

  console.log('Clearing old GTFS data...');
  await Promise.all([
    Stop.deleteMany({}),
    GtfsRoute.deleteMany({}),
    Trip.deleteMany({}),
    StopTime.deleteMany({}),
    GtfsDataset.deleteMany({}),
  ]);

  console.log('Creating indexes...');
  await Promise.all([
    Stop.syncIndexes(),
    GtfsRoute.syncIndexes(),
    Trip.syncIndexes(),
    StopTime.syncIndexes(),
    GtfsDataset.syncIndexes(),
  ]);

  console.log('Inserting data...');
  await Stop.insertMany(
    STOPS.map((s) => ({
      stopId: s.stopId,
      name: s.name,
      aliases: s.aliases,
      location: { type: 'Point', coordinates: [s.lng, s.lat] },
    }))
  );
  await GtfsRoute.insertMany(
    ROUTES.map((r) => ({
      routeId: r.routeId,
      shortName: r.shortName,
      longName: r.longName,
      color: r.color,
      routeType: 3,
    }))
  );
  await Trip.insertMany(trips);
  await StopTime.insertMany(stopTimes);

  await GtfsDataset.create({
    version,
    source: 'mock-kigali-seed',
    isActive: true,
    counts: { stops: STOPS.length, routes: ROUTES.length, trips: trips.length, stopTimes: stopTimes.length },
  });

  console.log(`Seed complete - version ${version}`);
  console.log(`  ${STOPS.length} stops, ${ROUTES.length} routes, ${trips.length} trips, ${stopTimes.length} stop times`);

  await disconnectDB();
}

main().catch(async (err) => {
  console.error('Seed failed:', err);
  await disconnectDB().catch(() => undefined);
  process.exit(1);
});