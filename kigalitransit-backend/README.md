Write-File "README.md" @'
# KigaliTransit Engine - Backend

Node.js + TypeScript + Express + MongoDB backend for KigaliTransit Engine, an offline-first public transit app for Kigali.

It provides three things to the mobile app:

1. **GTFS data sync** - the full schedule (stops, routes, trips, stop times), versioned so the app downloads it once and only re-downloads when it changes.
2. **Crowdsourced reports** - "Bus is Here" / "Bus is Full" reports that expire automatically, with abuse protection.
3. **Live GPS bridge** - a mock RURA GPS feed today, designed so the real RURA API can replace it by changing one class and one setting.

The backend is never required for route search: the app routes offline from its cached GTFS data. The backend only adds freshness and live signals.

---

## Requirements

- Node.js 20+ and npm
- Docker Desktop (runs MongoDB locally)

## Setup

```powershell
docker compose up -d          # start MongoDB
npm install
copy .env.example .env        # then edit values if needed
npm run seed                  # load the mock Kigali GTFS dataset
npm run dev                   # start the API on http://localhost:4000
```

Check it works:

```powershell
Invoke-RestMethod http://localhost:4000/api/health
```

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Run with auto-reload (development) |
| `npm run seed` | Replace GTFS data with the mock Kigali dataset |
| `npm run typecheck` | Check types without building |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled build (production) |

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | `production` hides internal error details and disables `simulatedTime` |
| `PORT` | `4000` | HTTP port |
| `MONGODB_URI` | - | MongoDB connection string (required) |
| `REPORT_TTL_MINUTES` | `15` | How long crowdsourced reports stay valid |
| `REPORT_COOLDOWN_SECONDS` | `120` | Minimum time before the same device can repeat the same report |
| `DEVICE_HASH_SALT` | dev value | Secret used to hash device IDs. **Set a long random value in production** |
| `GPS_PROVIDER` | `mock` | `mock` or `rura` (see "Swapping to the real RURA API") |
| `GPS_STALE_SECONDS` | `90` | GPS positions older than this are treated as stale |
| `MOCK_GPS_OFFLINE_ROUTES` | empty | Comma-separated lines whose mock GPS is "down", e.g. `R105` |
| `MOCK_GPS_MAX_DELAY_MINUTES` | `6` | Maximum simulated lateness per trip |
| `CORS_ORIGIN` | `*` | Allowed origins (comma-separated) |

---

## API reference

All responses are JSON and gzip-compressed. Errors look like `{ "error": "message" }`.

### Health

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Server and database status |

### GTFS data

| Method | Path | Description |
|---|---|---|
| GET | `/api/gtfs/version` | Current dataset version and counts (tiny - check this often) |
| GET | `/api/gtfs/bundle?currentVersion=X` | Full dataset, or `{ upToDate: true }` if `X` is current |
| GET | `/api/gtfs/stops?q=kimi&limit=10` | Search stops by name or informal alias |
| GET | `/api/gtfs/stops/nearby?lat=&lng=&radius=500` | Stops near a point (radius 50-5000 m) |
| GET | `/api/gtfs/routes` | All lines |
| GET | `/api/gtfs/routes/:routeId` | One line with ordered stops for both directions |

The bundle uses standard GTFS field names (`stop_id`, `stop_lat`, `route_short_name`, `arrival_time`, ...) so the app can load it directly into SQLite. Stops also include `aliases` (informal landmark names) for search.

### Crowdsourced reports

| Method | Path | Description |
|---|---|---|
| POST | `/api/reports` | Send a report. Header `X-Device-Id` required. Body: `{ routeId, stopId, reportType }` where `reportType` is `BUS_HERE` or `BUS_FULL` |
| GET | `/api/reports/status?routeId=&stopId=` | Aggregated rider reports (either or both filters) |

Rules:

- Reports expire after `REPORT_TTL_MINUTES` (MongoDB TTL index deletes them).
- The same device can send the same report for the same line and stop once per `REPORT_COOLDOWN_SECONDS` (HTTP 429 otherwise).
- A report is rejected if the stop is not on that line (HTTP 400).
- Counts are **unique riders**, not taps. Confidence: 1 rider = low, 2 = medium, 3+ = high.
- Every result is labeled `source: "crowdsourced"` and "Rider-reported".

### Live data (GPS + reconciliation)

| Method | Path | Description |
|---|---|---|
| GET | `/api/live/positions?routeId=` | Live bus positions for the map, each with `ageSeconds` and `stale` |
| GET | `/api/live/status?routeId=&stopId=` | Best live answer per line: `primarySource` is `official_gps`, `crowdsourced` or `none`, plus next arrivals per direction with ETA |

Reconciliation rules:

1. Fresh GPS exists for the line: `official_gps` is primary; rider reports are still returned as a secondary confirmation.
2. No fresh GPS, but rider reports exist: `crowdsourced` is primary.
3. Neither: `none` - the app should show its offline timetable estimate.

ETAs are approximate on purpose (Kigali hills and traffic). Buses ending their trip at a stop are not listed as arrivals there. A bus waiting at its starting terminal has no ETA yet - the app should show the next scheduled departure from its timetable.

Development only: add `simulatedTime=HH:MM` (Kigali time) to either live endpoint to test at any time of day. Disabled when `NODE_ENV=production`.

---

## Mobile app integration

**Device ID.** Generate a random ID (e.g. UUID v4) once on first launch, store it locally, and send it as `X-Device-Id` on every report. It is never linked to a person; the backend stores only a salted hash.

**GTFS sync flow.**

1. On first launch (with connectivity): `GET /api/gtfs/bundle`, save everything to SQLite, and store `version`.
2. On later app opens (with connectivity): `GET /api/gtfs/bundle?currentVersion=<saved version>`. If `upToDate` is `true`, do nothing. Otherwise replace the local data.
3. If the network fails, keep using the cached data and show its age in the UI.

**Live data.** Poll `/api/live/positions` every 10-15 seconds only while the map screen is open, and `/api/live/status` when a stop or result screen is opened. Never poll in the background - riders pay for their data.

**Offline.** If any live call fails, fall back silently to the last cached state. Route search must never depend on the backend.

---

## Swapping the mock GPS for the real RURA API

All code that uses GPS depends only on the `GpsProvider` interface in `src/modules/gps/gps.types.ts`. To switch to the real feed:

1. Create `src/modules/gps/ruraGpsProvider.ts` implementing `GpsProvider`:

```ts
import type { GpsPosition, GpsProvider, GpsQuery } from './gps.types';

export class RuraGpsProvider implements GpsProvider {
  readonly name = 'rura';

  async getPositions(query: GpsQuery): Promise<GpsPosition[]> {
    // 1. Call the RURA API (URL and key from env)
    // 2. Map each vehicle into GpsPosition:
    //    busId, routeId (must match GTFS route_id), directionId,
    //    lat, lng, heading, speedKmh, nextStopId, lastUpdated (ISO)
    // 3. If query.routeId is set, return only that line
    return [];
  }
}
```

2. Add any settings it needs (e.g. `RURA_API_URL`, `RURA_API_KEY`) to `src/config/env.ts` and `.env`.
3. In `src/modules/gps/gps.service.ts`, make `createProvider()` return `new RuraGpsProvider()` for the `rura` case.
4. Set `GPS_PROVIDER=rura` in `.env` and restart.

Nothing else changes: staleness checks, ETAs, reconciliation with rider reports, and all endpoints keep working. If RURA identifies lines or stops differently from the GTFS data, convert their IDs inside the provider.

---

## Updating the GTFS dataset

The current data is a **mock** Kigali network in `scripts/kigaliData.ts` (approximate coordinates, invented line numbers). To update it:

1. Edit stops and routes in `scripts/kigaliData.ts`.
2. Run `npm run seed`.
3. The dataset gets a new version (a hash of its contents). Apps see a new version on their next check and download the update. Re-seeding identical data keeps the same version, so apps do not re-download.

When official GTFS files from RURA or Kigali Bus Services are available, replace the mock generator with an importer that reads `stops.txt`, `routes.txt`, `trips.txt` and `stop_times.txt` into the same collections.

---

## Privacy (NCSA-aligned)

- Reports store line, stop, type, time and a salted device hash - **no location and no raw device ID**.
- Reports are deleted automatically after the TTL; no history is kept per user.
- Nearby-stop searches use coordinates only to answer the request; they are not stored.

## Project structure