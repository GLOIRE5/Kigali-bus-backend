import { createHash } from 'node:crypto';
import type { GpsPosition, GpsProvider, GpsQuery } from './gps.types';
import * as gtfsService from '../gtfs/gtfs.service';
import { bearingDegrees, haversineMeters } from '../../utils/geo';
import { gtfsTimeToMinutes, kigaliMinutesOfDay } from '../../utils/time';
import { env } from '../../config/env';

interface SimStop {
  stopId: string;
  lat: number;
  lng: number;
  arrival: number; // minutes since midnight
  departure: number;
}

interface SimTrip {
  tripId: string;
  routeId: string;
  directionId: 0 | 1;
  delayMinutes: number; // each trip runs a little late, like real traffic
  stops: SimStop[];
}

/** Same input always gives the same number, so a given trip is always equally late. */
function stableNumber(text: string): number {
  return createHash('md5').update(text).digest().readUInt32BE(0);
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Simulates buses moving along the GTFS timetable:
 * realistic speed between stops, dwell time at stops, no teleporting.
 */
export class MockGpsProvider implements GpsProvider {
  readonly name = 'mock';
  private cacheVersion: string | null = null;
  private tripsByRoute = new Map<string, SimTrip[]>();

  private async loadTrips(): Promise<Map<string, SimTrip[]>> {
    const bundle = await gtfsService.getBundle();
    if (this.cacheVersion === bundle.version) return this.tripsByRoute;

    const stopById = new Map(bundle.stops.map((s) => [s.stop_id, s]));
    const tripById = new Map<string, SimTrip>();

    for (const trip of bundle.trips) {
      tripById.set(trip.trip_id, {
        tripId: trip.trip_id,
        routeId: trip.route_id,
        directionId: trip.direction_id === 1 ? 1 : 0,
        delayMinutes: stableNumber(trip.trip_id) % (env.MOCK_GPS_MAX_DELAY_MINUTES + 1),
        stops: [],
      });
    }

    // stop_times in the bundle are already sorted by trip and stop sequence
    for (const st of bundle.stop_times) {
      const trip = tripById.get(st.trip_id);
      const stop = stopById.get(st.stop_id);
      if (!trip || !stop) continue;
      trip.stops.push({
        stopId: st.stop_id,
        lat: stop.stop_lat,
        lng: stop.stop_lon,
        arrival: gtfsTimeToMinutes(st.arrival_time),
        departure: gtfsTimeToMinutes(st.departure_time),
      });
    }

    const byRoute = new Map<string, SimTrip[]>();
    for (const trip of tripById.values()) {
      if (trip.stops.length < 2) continue;
      const list = byRoute.get(trip.routeId) ?? [];
      list.push(trip);
      byRoute.set(trip.routeId, list);
    }

    this.tripsByRoute = byRoute;
    this.cacheVersion = bundle.version;
    return byRoute;
  }

  async getPositions(query: GpsQuery): Promise<GpsPosition[]> {
    const tripsByRoute = await this.loadTrips();
    const at = query.at ?? new Date();
    const nowMinutes = kigaliMinutesOfDay(at);

    // Lines listed here behave as if their GPS feed is down (to test the crowdsourced fallback)
    const offlineRoutes = new Set(
      env.MOCK_GPS_OFFLINE_ROUTES.split(',').map((r) => r.trim()).filter(Boolean)
    );

    const routeIds = query.routeId ? [query.routeId] : [...tripsByRoute.keys()];
    const positions: GpsPosition[] = [];

    for (const routeId of routeIds) {
      if (offlineRoutes.has(routeId)) continue;
      for (const trip of tripsByRoute.get(routeId) ?? []) {
        const position = this.positionOf(trip, nowMinutes - trip.delayMinutes, at);
        if (position) positions.push(position);
      }
    }

    return positions;
  }

  private positionOf(trip: SimTrip, t: number, at: Date): GpsPosition | null {
    const stops = trip.stops;
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (!first || !last || t < first.departure || t > last.arrival) return null; // not on the road

    // Real feeds lag a little: report the position as 3-20 seconds old
    const lagSeconds = 3 + (stableNumber(`${trip.tripId}:${Math.floor(at.getTime() / 30000)}`) % 18);
    const base = {
      busId: `MOCK-${trip.tripId}`,
      routeId: trip.routeId,
      directionId: trip.directionId,
      lastUpdated: new Date(at.getTime() - lagSeconds * 1000).toISOString(),
    };

    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i]!;
      const next = stops[i + 1];

      // Dwelling at a stop
      if (t >= stop.arrival && t <= stop.departure) {
        return {
          ...base,
          lat: stop.lat,
          lng: stop.lng,
          heading: next ? Math.round(bearingDegrees(stop.lat, stop.lng, next.lat, next.lng)) : 0,
          speedKmh: 0,
          nextStopId: next?.stopId ?? null,
        };
      }

      // Driving between this stop and the next one
      if (next && t > stop.departure && t < next.arrival) {
        const fraction = (t - stop.departure) / (next.arrival - stop.departure);
        const meters = haversineMeters(stop.lat, stop.lng, next.lat, next.lng);
        const hours = (next.arrival - stop.departure) / 60;
        return {
          ...base,
          lat: round6(stop.lat + (next.lat - stop.lat) * fraction),
          lng: round6(stop.lng + (next.lng - stop.lng) * fraction),
          heading: Math.round(bearingDegrees(stop.lat, stop.lng, next.lat, next.lng)),
          speedKmh: Math.round(meters / 1000 / hours),
          nextStopId: next.stopId,
        };
      }
    }

    return null;
  }
}