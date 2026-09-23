const KIGALI_UTC_OFFSET_MINUTES = 120; // Kigali is UTC+2 all year (no daylight saving)

/** 335 -> "05:35:00". GTFS allows hours above 24 for trips after midnight. */
export function minutesToGtfsTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
}

/** "05:35:00" -> 335 */
export function gtfsTimeToMinutes(time: string): number {
  const [hours = 0, minutes = 0, seconds = 0] = time.split(':').map(Number);
  return hours * 60 + minutes + seconds / 60;
}

/** Minutes since midnight in Kigali local time (with fractions), e.g. 08:30:30 -> 510.5 */
export function kigaliMinutesOfDay(date: Date): number {
  const minutes = date.getTime() / 60000 + KIGALI_UTC_OFFSET_MINUTES;
  return ((minutes % 1440) + 1440) % 1440;
}