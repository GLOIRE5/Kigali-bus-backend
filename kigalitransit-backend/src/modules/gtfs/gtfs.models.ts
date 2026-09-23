import { Schema, model } from 'mongoose';

// GeoJSON point. Coordinates are [longitude, latitude] - GeoJSON order, not lat/lng.
const pointSchema = new Schema(
  {
    type: { type: String, enum: ['Point'], required: true, default: 'Point' },
    coordinates: { type: [Number], required: true },
  },
  { _id: false }
);

const stopSchema = new Schema({
  stopId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  // Informal names riders actually use ("Town", "KCC", "Ku kibuga cy'indege")
  aliases: { type: [String], default: [] },
  location: { type: pointSchema, required: true },
});
stopSchema.index({ location: '2dsphere' });

const routeSchema = new Schema({
  routeId: { type: String, required: true, unique: true },
  shortName: { type: String, required: true },
  longName: { type: String, required: true },
  routeType: { type: Number, required: true, default: 3 }, // 3 = bus in GTFS
  color: { type: String, required: true, default: '1E88E5' },
});

const tripSchema = new Schema({
  tripId: { type: String, required: true, unique: true },
  routeId: { type: String, required: true },
  serviceId: { type: String, required: true },
  headsign: { type: String, required: true },
  directionId: { type: Number, required: true, enum: [0, 1] },
});
tripSchema.index({ routeId: 1, directionId: 1 });

const stopTimeSchema = new Schema({
  tripId: { type: String, required: true },
  stopId: { type: String, required: true, index: true },
  stopSequence: { type: Number, required: true },
  arrivalTime: { type: String, required: true }, // "HH:MM:SS"
  departureTime: { type: String, required: true },
});
stopTimeSchema.index({ tripId: 1, stopSequence: 1 }, { unique: true });

// One document per published dataset; the app compares versions to decide whether to re-download.
const datasetSchema = new Schema({
  version: { type: String, required: true, unique: true },
  source: { type: String, required: true },
  isActive: { type: Boolean, required: true, default: false, index: true },
  publishedAt: { type: Date, required: true, default: Date.now },
  counts: {
    stops: { type: Number, required: true },
    routes: { type: Number, required: true },
    trips: { type: Number, required: true },
    stopTimes: { type: Number, required: true },
  },
});

export const Stop = model('Stop', stopSchema, 'gtfs_stops');
export const GtfsRoute = model('GtfsRoute', routeSchema, 'gtfs_routes');
export const Trip = model('Trip', tripSchema, 'gtfs_trips');
export const StopTime = model('StopTime', stopTimeSchema, 'gtfs_stop_times');
export const GtfsDataset = model('GtfsDataset', datasetSchema, 'gtfs_datasets');