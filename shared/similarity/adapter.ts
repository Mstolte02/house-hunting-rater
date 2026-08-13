/**
 * IndianaSimilarityAdapter — the housing app's only entry point to the Indiana
 * Similarity model.
 *
 * Everything the app knows about similarity comes through here: town matching, the raw
 * metric, the percentile curve, the distribution the Tuning page charts. If the
 * indiana-towns project changes shape, this file absorbs it and nothing else moves.
 */

import { scoreToGrade, DEFAULT_GRADE_SCALE, type GradeBand } from "../scoring/grade.js";
import { SimilarityCurve, type CurveAnchor } from "./curve.js";
import {
  computeRawSimilarity,
  DEFAULT_QUALITY_FEATURES,
  type SimilarityOptions,
} from "./similarity.js";
import type { FamilyScore, SimMeta, SimTown } from "./types.js";

export const DEFAULT_REFERENCE_TOWN = "Westfield";

export interface AdapterConfig extends SimilarityOptions {
  referenceTown?: string;
  anchors?: CurveAnchor[];
  aPlusRaw?: number | null;
  gradeScale?: GradeBand[];
}

export interface TownSimilarity {
  town: string;
  county: string | null;
  /** 0-100 raw similarity to the reference town, higher = more similar. */
  raw: number;
  /** Position in the peer distribution, 0-100. */
  percentile: number;
  /** Curved 0-100 housing-app score. */
  score: number;
  grade: string | null;
  byFamily: FamilyScore[];
  isReference: boolean;
}

export class IndianaSimilarityAdapter {
  readonly meta: SimMeta;
  readonly towns: SimTown[];
  readonly reference: SimTown;
  readonly curve: SimilarityCurve;
  private readonly config: AdapterConfig;
  private readonly rawByName = new Map<string, number>();
  private readonly byName = new Map<string, SimTown>();

  constructor(towns: SimTown[], meta: SimMeta, config: AdapterConfig = {}) {
    this.meta = meta;
    this.towns = towns;
    this.config = config;

    for (const t of towns) this.byName.set(normalize(t.name), t);

    const refName = config.referenceTown ?? DEFAULT_REFERENCE_TOWN;
    const ref = this.byName.get(normalize(refName));
    if (!ref) {
      throw new Error(
        `Reference town "${refName}" is not in the similarity dataset ` +
          `(${towns.length} towns loaded). Check data/similarity/towns.json.`
      );
    }
    this.reference = ref;

    for (const t of towns) {
      this.rawByName.set(
        t.name,
        computeRawSimilarity(ref, t, meta, config).overall
      );
    }

    const peers = towns
      .filter((t) => t.name !== ref.name)
      .map((t) => this.rawByName.get(t.name) as number);
    this.curve = new SimilarityCurve(peers, {
      anchors: config.anchors,
      aPlusRaw: config.aPlusRaw ?? null,
    });
  }

  get gradeScale(): GradeBand[] {
    return this.config.gradeScale ?? DEFAULT_GRADE_SCALE;
  }

  townNames(): string[] {
    return this.towns.map((t) => t.name).sort((a, b) => a.localeCompare(b));
  }

  /**
   * Find the dataset town for a property. Tries the town name, then the city field,
   * then — only if coordinates are supplied — the nearest town within 20 miles.
   * Returns null rather than guessing wildly; the UI then asks you to pick one.
   */
  matchTown(
    city: string | null | undefined,
    lat?: number | null,
    lon?: number | null
  ): SimTown | null {
    if (city) {
      const key = normalize(city);
      const hit = this.byName.get(key);
      if (hit) return hit;
    }
    if (lat != null && lon != null) {
      let best: { town: SimTown; d: number } | null = null;
      for (const t of this.towns) {
        const d = haversineMiles(lat, lon, t.lat, t.lon);
        if (!best || d < best.d) best = { town: t, d };
      }
      if (best && best.d <= 20) return best.town;
    }
    return null;
  }

  similarityFor(town: SimTown): TownSimilarity {
    const raw = this.rawByName.get(town.name);
    const detail = computeRawSimilarity(this.reference, town, this.meta, this.config);
    const rawScore = raw ?? detail.overall;
    const score = this.curve.toScore(rawScore);
    return {
      town: town.name,
      county: town.county,
      raw: rawScore,
      percentile: this.curve.percentileOf(rawScore),
      score,
      grade: scoreToGrade(score, this.gradeScale),
      byFamily: detail.byFamily,
      isReference: town.name === this.reference.name,
    };
  }

  /** Convenience: match + score in one step. Null when no town could be matched. */
  scoreForCity(
    city: string | null | undefined,
    lat?: number | null,
    lon?: number | null
  ): TownSimilarity | null {
    const town = this.matchTown(city, lat, lon);
    return town ? this.similarityFor(town) : null;
  }

  /** Every town scored, best first — powers the Tuning page's distribution view. */
  allScored(): TownSimilarity[] {
    return this.towns
      .map((t) => this.similarityFor(t))
      .sort((a, b) => b.raw - a.raw);
  }

  /** Count of peer towns per letter grade, in scale order, for the histogram. */
  gradeDistribution(): { grade: string; count: number }[] {
    const order = [...this.gradeScale].sort((a, b) => b.min - a.min).map((b) => b.grade);
    const counts = new Map<string, number>(order.map((g) => [g, 0]));
    for (const t of this.towns) {
      if (t.name === this.reference.name) continue;
      const g = scoreToGrade(
        this.curve.toScore(this.rawByName.get(t.name) as number),
        this.gradeScale
      );
      if (g) counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    return order.map((grade) => ({ grade, count: counts.get(grade) ?? 0 }));
  }

  /** Reference-relative stats the Tuning page prints under the chart. */
  summary() {
    const peers = this.curve.peers;
    return {
      reference: this.reference.name,
      generated: this.meta.generated,
      n_towns: this.towns.length,
      one_sided: this.config.oneSided !== false,
      quality_features: [...(this.config.qualityFeatures ?? DEFAULT_QUALITY_FEATURES)],
      a_plus_raw: this.curve.aPlusRaw,
      raw_min: peers[0] ?? null,
      raw_median: peers.length ? peers[Math.floor(peers.length / 2)] : null,
      raw_max: peers[peers.length - 1] ?? null,
    };
  }
}

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/^(town|city|village) of\s+/, "")
    .replace(/\s+(town|city)$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function haversineMiles(
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
