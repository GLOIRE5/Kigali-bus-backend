import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  REPORT_TTL_MINUTES: z.coerce.number().min(1).max(60).default(15),
  REPORT_COOLDOWN_SECONDS: z.coerce.number().min(10).max(3600).default(120),
  DEVICE_HASH_SALT: z.string().min(8, 'DEVICE_HASH_SALT must be at least 8 characters').default('dev-only-salt-change-me'),
  GPS_PROVIDER: z.enum(['mock', 'rura']).default('mock'),
  GPS_STALE_SECONDS: z.coerce.number().int().min(10).max(3600).default(90),
  MOCK_GPS_OFFLINE_ROUTES: z.string().default(''),
  MOCK_GPS_MAX_DELAY_MINUTES: z.coerce.number().int().min(0).max(30).default(6),
  CORS_ORIGIN: z.string().default('*'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;