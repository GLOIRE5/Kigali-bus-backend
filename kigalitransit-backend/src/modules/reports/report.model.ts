import { Schema, model } from 'mongoose';

export const REPORT_TYPES = ['BUS_HERE', 'BUS_FULL'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

const reportSchema = new Schema({
  routeId: { type: String, required: true },
  stopId: { type: String, required: true },
  reportType: { type: String, required: true, enum: REPORT_TYPES },
  // One-way hash of the phone's ID. No raw device ID and no location is stored (NCSA privacy).
  deviceHash: { type: String, required: true },
  createdAt: { type: Date, required: true, default: Date.now },
  expiresAt: { type: Date, required: true },
});

// MongoDB deletes each report automatically once expiresAt passes.
reportSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
reportSchema.index({ routeId: 1, stopId: 1, createdAt: -1 });
reportSchema.index({ stopId: 1, createdAt: -1 });
reportSchema.index({ deviceHash: 1, routeId: 1, stopId: 1, reportType: 1, createdAt: -1 });

export const Report = model('Report', reportSchema, 'crowd_reports');