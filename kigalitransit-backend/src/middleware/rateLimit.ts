import { rateLimit } from 'express-rate-limit';

// Backstop against floods. Mobile carriers share one IP across many phones,
// so this stays generous; the per-device cooldown in report.service is the main guard.
export const reportWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many reports from this network. Please wait a minute and try again.' },
});