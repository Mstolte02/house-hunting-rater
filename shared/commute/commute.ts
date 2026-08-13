/**
 * Commute scoring, in minutes of actual driving.
 *
 * Drive times come from a real routing engine (OSRM) over the real road network, not
 * from straight-line distance — a crow-flies estimate put Westfield → Knightstown at
 * ~41 miles when the drive is 50.5 miles and 65 minutes, which is exactly the kind of
 * error that would quietly mis-rank a house.
 *
 * Routes are fetched once per property/destination pair and cached in the database, so
 * the app is offline in normal use: it only reaches the network when a property is
 * added or its address changes.
 */

export interface Destination {
  /** Stable id used in metric keys, e.g. "mark" -> metric "commute:mark". */
  key: string;
  label: string;
  address: string;
  lat: number;
  lon: number;
}

/** minutes -> 0-100. Sorted ascending by minutes; score descends. */
export interface CommuteAnchor {
  minutes: number;
  score: number;
}

/**
 * Default curve. A 15-minute drive is close to ideal, half an hour is tolerable, and an
 * hour each way is the kind of thing you'd resent by February.
 */
export const DEFAULT_COMMUTE_ANCHORS: CommuteAnchor[] = [
  { minutes: 0, score: 100 },
  { minutes: 10, score: 96 },
  { minutes: 15, score: 92 },
  { minutes: 20, score: 86 },
  { minutes: 25, score: 79 },
  { minutes: 30, score: 72 },
  { minutes: 40, score: 57 },
  { minutes: 50, score: 42 },
  { minutes: 60, score: 28 },
  { minutes: 75, score: 12 },
  { minutes: 90, score: 0 },
];

/** Piecewise-linear, monotonically non-increasing, clamped at both ends. */
export function minutesToScore(
  minutes: number,
  anchors: CommuteAnchor[] = DEFAULT_COMMUTE_ANCHORS
): number {
  const a = [...anchors].sort((x, y) => x.minutes - y.minutes);
  if (a.length === 0) return 0;
  if (minutes <= a[0].minutes) return a[0].score;
  for (let i = 0; i < a.length - 1; i++) {
    const lo = a[i];
    const hi = a[i + 1];
    if (minutes <= hi.minutes) {
      const span = hi.minutes - lo.minutes;
      const t = span <= 0 ? 0 : (minutes - lo.minutes) / span;
      return lo.score + (hi.score - lo.score) * t;
    }
  }
  return a[a.length - 1].score;
}

/** A routed trip, as stored in the cache. */
export interface CommuteLeg {
  destination: string;
  label: string;
  minutes: number;
  miles: number;
  /** Where the property's coordinates came from, so the UI can be honest about it. */
  origin: "address" | "town";
  origin_label: string;
  fetched_at: string;
}

export interface CommuteResult extends CommuteLeg {
  score: number;
}

export function scoreLeg(
  leg: CommuteLeg,
  anchors: CommuteAnchor[] = DEFAULT_COMMUTE_ANCHORS
): CommuteResult {
  return { ...leg, score: minutesToScore(leg.minutes, anchors) };
}

export function haversineMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
