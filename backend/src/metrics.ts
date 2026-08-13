/**
 * The registry of automatic score sources.
 *
 * This is what replaced the old "formula" scoring method. That option could be selected
 * but never configured, so it did nothing — a category set to "formula" scored exactly
 * like a manual one. Instead, a category or subcriterion names a *metric*: a concrete
 * source that already knows how to produce a 0-100 number. The list is generated from
 * live configuration, so adding a commute destination on the Tuning page immediately
 * makes it selectable as a scoring source.
 *
 * The scoring engine never sees these keys. It receives resolved numbers, which keeps
 * it free of any property- or category-specific logic.
 */

import { db, getSetting } from "./db/index.js";
import { getAdapter, similaritySettings } from "./similarity-source.js";
import { geocode, route } from "./routing.js";
import {
  DEFAULT_COMMUTE_ANCHORS,
  scoreLeg,
  type CommuteAnchor,
  type CommuteLeg,
  type CommuteResult,
  type Destination,
} from "../../shared/commute/commute.js";
import type { Property } from "../../shared/types.js";

export const SIMILARITY_METRIC = "similarity:westfield";
export const COMMUTE_PREFIX = "commute:";

/** Mark's and Rachel's work, geocoded once so these never need looking up again. */
export const DEFAULT_DESTINATIONS: Destination[] = [
  {
    key: "mark",
    label: "Mark's work",
    address: "9225 Priority Way West Dr, Indianapolis, IN 46240",
    lat: 39.9224008,
    lon: -86.1066417,
  },
  {
    key: "rachel",
    label: "Rachel's work",
    address: "Knightstown High School, 8149 W US-40, Knightstown, IN 46148",
    lat: 39.7925966,
    lon: -85.5421078,
  },
];

export interface CommuteSettings {
  destinations: Destination[];
  anchors: CommuteAnchor[];
}

export function commuteSettings(): CommuteSettings {
  return {
    destinations: getSetting("commute_destinations", DEFAULT_DESTINATIONS),
    anchors: getSetting("commute_anchors", DEFAULT_COMMUTE_ANCHORS),
  };
}

export interface MetricInfo {
  key: string;
  label: string;
  description: string;
}

/** Everything selectable as an automatic source, for the Tuning dropdown. */
export function metricRegistry(): MetricInfo[] {
  const sim = similaritySettings();
  const { destinations } = commuteSettings();
  return [
    {
      key: SIMILARITY_METRIC,
      label: `${sim.referenceTown} Similarity`,
      description: `How much the property's town resembles ${sim.referenceTown}, curved against all Indiana towns.`,
    },
    ...destinations.map((d) => ({
      key: `${COMMUTE_PREFIX}${d.key}`,
      label: `Drive to ${d.label}`,
      description: `Minutes of actual driving to ${d.address}.`,
    })),
  ];
}

// --- cache ------------------------------------------------------------------

interface CacheRow {
  property_id: number;
  destination: string;
  minutes: number;
  miles: number;
  origin: "address" | "town";
  origin_label: string | null;
  fetched_at: string;
}

function cachedLegs(propertyId: number): CacheRow[] {
  return db
    .prepare("SELECT * FROM commute_cache WHERE property_id = ?")
    .all(propertyId) as CacheRow[];
}

/** Scored drive times for a property, straight from the cache. Never hits the network. */
export function commutesFor(property: Property): CommuteResult[] {
  const { destinations, anchors } = commuteSettings();
  const rows = new Map(cachedLegs(property.id).map((r) => [r.destination, r]));
  const out: CommuteResult[] = [];
  for (const d of destinations) {
    const row = rows.get(d.key);
    if (!row) continue;
    const leg: CommuteLeg = {
      destination: d.key,
      label: d.label,
      minutes: row.minutes,
      miles: row.miles,
      origin: row.origin,
      origin_label: row.origin_label ?? "",
      fetched_at: row.fetched_at,
    };
    out.push(scoreLeg(leg, anchors));
  }
  return out;
}

/** Destinations with no cached route yet — what a Recalculate would go and fetch. */
export function missingCommutes(property: Property): string[] {
  const cached = new Set(cachedLegs(property.id).map((r) => r.destination));
  return commuteSettings()
    .destinations.filter((d) => !cached.has(d.key))
    .map((d) => d.label);
}

// --- filling the cache (the only network path) ------------------------------

export interface RefreshOutcome {
  routed: number;
  failed: string[];
  origin: "address" | "town" | null;
  origin_label: string | null;
  geocoded: { lat: number; lon: number } | null;
}

/**
 * Look up this property's drive times and store them.
 *
 * Geocodes the street address first when we don't already have coordinates, because a
 * town centre gives every house in a town the same commute. Anything that fails is
 * reported rather than approximated — a missing drive time is more honest than a
 * plausible wrong one.
 */
export async function refreshCommutes(
  property: Property,
  { force = false }: { force?: boolean } = {}
): Promise<RefreshOutcome> {
  const { destinations } = commuteSettings();
  const failed: string[] = [];
  let lat = property.latitude;
  let lon = property.longitude;
  let origin: "address" | "town" | null = lat != null && lon != null ? "address" : null;
  let originLabel = origin === "address" ? "this property's coordinates" : null;
  let geocoded: { lat: number; lon: number } | null = null;

  if (lat == null || lon == null) {
    const parts = [property.address, property.city, property.state, property.zip]
      .filter(Boolean)
      .join(", ");
    if (parts) {
      const hit = await geocode(parts);
      if (hit) {
        lat = hit.lat;
        lon = hit.lon;
        origin = "address";
        originLabel = property.address ?? parts;
        geocoded = { lat, lon };
      }
    }
  }

  if (lat == null || lon == null) {
    // Fall back to the centre of the matched town so a property with only a city still
    // gets a real routed time, just a less precise one.
    const town = getAdapter().matchTown(property.similarity_town ?? property.city);
    if (town) {
      lat = town.lat;
      lon = town.lon;
      origin = "town";
      originLabel = `the centre of ${town.name}`;
    }
  }

  if (lat == null || lon == null) {
    return { routed: 0, failed: destinations.map((d) => d.label), origin: null, origin_label: null, geocoded: null };
  }

  const upsert = db.prepare(
    `INSERT INTO commute_cache (property_id, destination, minutes, miles, origin, origin_label, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(property_id, destination) DO UPDATE SET
       minutes = excluded.minutes, miles = excluded.miles,
       origin = excluded.origin, origin_label = excluded.origin_label,
       fetched_at = excluded.fetched_at`
  );

  const cached = new Set(cachedLegs(property.id).map((r) => r.destination));
  let routed = 0;
  for (const d of destinations) {
    if (!force && cached.has(d.key)) continue;
    const r = await route({ lat, lon }, { lat: d.lat, lon: d.lon });
    if (!r) {
      failed.push(d.label);
      continue;
    }
    upsert.run(property.id, d.key, r.minutes, r.miles, origin, originLabel);
    routed++;
  }

  if (geocoded) {
    db.prepare("UPDATE properties SET latitude = ?, longitude = ? WHERE id = ?")
      .run(geocoded.lat, geocoded.lon, property.id);
  }

  return { routed, failed, origin, origin_label: originLabel, geocoded };
}

/** Drop cached routes for a property — used when its address changes. */
export function clearCommutes(propertyId: number): void {
  db.prepare("DELETE FROM commute_cache WHERE property_id = ?").run(propertyId);
}

/**
 * Resolve every metric key this property can supply a value for.
 * Unknown keys resolve to null rather than throwing, so deleting a commute destination
 * that a category still points at degrades to "unscored" instead of breaking the app.
 */
export function resolveMetrics(property: Property): Record<string, number | null> {
  const out: Record<string, number | null> = {};

  const sim = getAdapter().scoreForCity(
    property.similarity_town ?? property.city,
    property.latitude,
    property.longitude
  );
  out[SIMILARITY_METRIC] = sim?.score ?? null;

  for (const c of commutesFor(property)) {
    out[`${COMMUTE_PREFIX}${c.destination}`] = c.score;
  }
  return out;
}
