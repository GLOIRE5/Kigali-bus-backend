// MOCK DATA for development. Coordinates are approximate; line numbers are not real RURA lines.

export interface SeedStop {
  stopId: string;
  name: string;
  lat: number;
  lng: number;
  aliases: string[];
}

export interface SeedRoute {
  routeId: string;
  shortName: string;
  longName: string;
  color: string;
  headwayMinutes: number; // a bus every N minutes
  stopIds: string[]; // in order, direction 0
}

export const SERVICE_START_MINUTES = 5 * 60 + 30; // 05:30
export const SERVICE_END_MINUTES = 22 * 60; // 22:00

export const STOPS: SeedStop[] = [
  { stopId: 'NYB', name: 'Nyabugogo Bus Park', lat: -1.9396, lng: 30.0445, aliases: ['Nyabugogo', 'Nyabugogo Taxi Park', 'Gare routiere'] },
  { stopId: 'DTN', name: 'Downtown Bus Park', lat: -1.9447, lng: 30.06, aliases: ['Downtown', 'Town', 'Mu mujyi', 'City Centre', 'CBD', 'Kigali City Tower'] },
  { stopId: 'KNB', name: 'Kinamba', lat: -1.9335, lng: 30.0598, aliases: ['Kinamba'] },
  { stopId: 'KCY', name: 'Kacyiru', lat: -1.9368, lng: 30.085, aliases: ['Kacyiru', 'Kacyiru Police', 'Ministries'] },
  { stopId: 'KMH', name: 'Kimihurura', lat: -1.9505, lng: 30.079, aliases: ['Kimihurura', 'Kimihurura Roundabout'] },
  { stopId: 'GSH', name: 'Gishushu', lat: -1.953, lng: 30.0935, aliases: ['Gishushu', 'Kigali Heights', 'KCC', 'Convention Centre'] },
  { stopId: 'RMR', name: 'Remera (Giporoso)', lat: -1.9575, lng: 30.111, aliases: ['Remera', 'Giporoso', 'Amahoro Stadium'] },
  { stopId: 'KMR', name: 'Kimironko Market', lat: -1.9495, lng: 30.1265, aliases: ['Kimironko', 'Kimironko Market', 'Isoko rya Kimironko'] },
  { stopId: 'KSM', name: 'Kisimenti', lat: -1.962, lng: 30.115, aliases: ['Kisimenti'] },
  { stopId: 'KNM', name: 'Kanombe Airport', lat: -1.9686, lng: 30.1395, aliases: ['Airport', 'Kanombe', 'Kigali International Airport', "Ku kibuga cy'indege"] },
  { stopId: 'SNT', name: 'Sonatubes', lat: -1.964, lng: 30.089, aliases: ['Sonatubes'] },
  { stopId: 'KCK', name: 'Kicukiro Centre', lat: -1.979, lng: 30.103, aliases: ['Kicukiro', 'Kicukiro Centre', 'Centre'] },
  { stopId: 'NYM', name: 'Nyamirambo', lat: -1.976, lng: 30.043, aliases: ['Nyamirambo', 'Nyamirambo Stadium'] },
  { stopId: 'ULK', name: 'Gisozi (ULK)', lat: -1.924, lng: 30.068, aliases: ['Gisozi', 'ULK', 'Kigali Independent University'] },
];

export const ROUTES: SeedRoute[] = [
  { routeId: 'R101', shortName: '101', longName: 'Nyabugogo - Kimironko via Downtown & Remera', color: 'E53935', headwayMinutes: 10, stopIds: ['NYB', 'DTN', 'KMH', 'GSH', 'RMR', 'KMR'] },
  { routeId: 'R102', shortName: '102', longName: 'Nyabugogo - Kacyiru via Kinamba', color: '1E88E5', headwayMinutes: 15, stopIds: ['NYB', 'KNB', 'KCY'] },
  { routeId: 'R103', shortName: '103', longName: 'Kimironko - Kacyiru via Gishushu', color: '43A047', headwayMinutes: 12, stopIds: ['KMR', 'RMR', 'GSH', 'KCY'] },
  { routeId: 'R104', shortName: '104', longName: 'Downtown - Kicukiro via Sonatubes', color: 'FB8C00', headwayMinutes: 15, stopIds: ['DTN', 'SNT', 'KCK'] },
  { routeId: 'R105', shortName: '105', longName: 'Downtown - Nyamirambo', color: '8E24AA', headwayMinutes: 20, stopIds: ['DTN', 'NYM'] },
  { routeId: 'R106', shortName: '106', longName: 'Remera - Kanombe Airport via Kisimenti', color: '00ACC1', headwayMinutes: 20, stopIds: ['RMR', 'KSM', 'KNM'] },
  { routeId: 'R107', shortName: '107', longName: 'Gisozi (ULK) - Downtown via Nyabugogo', color: '6D4C41', headwayMinutes: 15, stopIds: ['ULK', 'KNB', 'NYB', 'DTN'] },
];