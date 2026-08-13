/**
 * The only part of this app that touches the network.
 *
 * Geocoding (Nominatim) turns a street address into coordinates; routing (OSRM) turns a
 * pair of coordinates into an actual drive time over the road network. Both are free and
 * keyless. Results are written to the commute_cache table, so a property is looked up
 * once when it's added or its address changes and never again — scoring, ranking and
 * tuning all read the cache and work with the network unplugged.
 *
 * Everything here fails soft: a timeout or an outage leaves the cache untouched and the
 * commute simply unscored, which the UI surfaces with a Recalculate button. It never
 * substitutes a guess for a real drive time.
 */

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OSRM = "https://router.project-osrm.org/route/v1/driving";

// Nominatim's usage policy asks for an identifying User-Agent and at most 1 req/sec.
const UA = "housing-rater/1.0 (personal house-hunting tool)";
const TIMEOUT_MS = 12_000;

let lastNominatimCall = 0;

async function politeDelay(): Promise<void> {
  const since = Date.now() - lastNominatimCall;
  if (since < 1100) await new Promise((r) => setTimeout(r, 1100 - since));
  lastNominatimCall = Date.now();
}

async function fetchJson(url: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export interface GeocodeResult {
  lat: number;
  lon: number;
  display_name: string;
}

/** Street address -> coordinates. Null when nothing matched or the service is down. */
export async function geocode(query: string): Promise<GeocodeResult | null> {
  if (!query.trim()) return null;
  try {
    await politeDelay();
    const url = `${NOMINATIM}?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=us`;
    const data = await fetchJson(url);
    if (!Array.isArray(data) || data.length === 0) return null;
    const lat = Number(data[0].lat);
    const lon = Number(data[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon, display_name: String(data[0].display_name ?? "") };
  } catch {
    return null;
  }
}

export interface RouteResult {
  minutes: number;
  miles: number;
}

/**
 * Driving route between two points. Null on failure — never an estimate.
 *
 * OSRM snaps each coordinate to the nearest road, so a point it can't place (mid-ocean,
 * or a bad geocode) can come back as a perfectly valid-looking zero-length route. A
 * 0-minute commute scores 100, so that failure would read as an ideal house. We sanity
 * check the answer against the straight-line distance and reject anything shorter than
 * the crow flies allows.
 */
export async function route(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number }
): Promise<RouteResult | null> {
  try {
    const url =
      `${OSRM}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`;
    const data = await fetchJson(url);
    if (data?.code !== "Ok" || !data.routes?.length) return null;
    const r = data.routes[0];
    if (!Number.isFinite(r.duration) || !Number.isFinite(r.distance)) return null;

    const miles = r.distance / 1609.344;
    const minutes = r.duration / 60;
    const crow = haversineMiles(from.lat, from.lon, to.lat, to.lon);

    // A road route can never be meaningfully shorter than the straight line between
    // its endpoints; 0.8x leaves room for snapping slack on short hops.
    if (crow > 0.5 && (miles < crow * 0.8 || minutes <= 0)) return null;

    return { minutes, miles };
  } catch {
    return null;
  }
}

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
