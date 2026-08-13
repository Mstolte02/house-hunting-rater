/**
 * Shapes of the Indiana Similarity snapshot produced by the indiana-towns pipeline
 * (pipeline/export.py -> web/public/data/{towns,meta}.json).
 *
 * These mirror indiana-towns/web/src/lib/types.ts. They are duplicated rather than
 * imported so the housing app has no build-time dependency on that project — the only
 * coupling is the JSON snapshot under data/similarity/, refreshed on demand.
 */

export interface SimFeatureMeta {
  key: string;
  label: string;
  family: string;
  invert: boolean;
}

export interface SimMeta {
  generated: string;
  n_towns: number;
  features: SimFeatureMeta[];
  families: string[];
  family_features: Record<string, string[]>;
  family_scales: Record<string, number>;
  default_feature_weights: Record<string, number>;
  default_family_weights: Record<string, number>;
}

export interface SimTown {
  geoid: string;
  name: string;
  lat: number;
  lon: number;
  county: string | null;
  msa: string | null;
  cluster: number;
  raw: Record<string, number | null>;
  /** Oriented + z-scored features. Higher always means "better/more". */
  norm: Record<string, number | null>;
}

export interface FamilyScore {
  family: string;
  score: number;
  weight: number;
}

export interface RawSimilarity {
  /** 0-100, higher = more like the reference town. */
  overall: number;
  byFamily: FamilyScore[];
}
