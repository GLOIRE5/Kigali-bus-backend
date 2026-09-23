/**
 * What any live GPS feed returns for one bus.
 * When the real RURA API exists, map its response into this shape - nothing else changes.
 */
export interface GpsPosition {
  busId: string;
  routeId: string;
  directionId: 0 | 1;
  lat: number;
  lng: number;
  heading: number; // degrees, 0 = north, 90 = east
  speedKmh: number;
  nextStopId: string | null;
  lastUpdated: string; // ISO timestamp reported by the feed
}

export interface GpsQuery {
  routeId?: string;
  /** Development only: simulate a different time of day. Real providers ignore it. */
  at?: Date;
}

/**
 * Any live GPS source implements this: MockGpsProvider today, a RuraGpsProvider later.
 * The map, status and reconciliation code depend only on this interface.
 */
export interface GpsProvider {
  readonly name: string;
  getPositions(query: GpsQuery): Promise<GpsPosition[]>;
}