/**
 * Raw similarity between a candidate town and the reference town (Westfield).
 *
 * This is the indiana-towns Compare-page metric (100 * exp(-d / s_family), family-weighted)
 * with one deliberate change for house hunting: **quality features are one-sided.**
 *
 * The original metric is a true distance, so it is symmetric — a town that is five times
 * SAFER than Westfield is penalized exactly as hard as one five times more dangerous.
 * That is correct for "which towns resemble each other" and wrong for "where should we
 * live": it dropped Zionsville (violent crime 15/100k vs Westfield's 81) to the 65th
 * percentile. For features where more is unambiguously better for a family — safety,
 * schools, income, affordability, wages — we clamp the difference at zero when the
 * candidate beats the reference, so being better never costs a town points.
 *
 * Character features (population, distances to amenities, counts) stay two-sided: the
 * goal there really is to match Westfield's feel, and a city ten times its size is
 * different rather than better.
 *
 * Direction check (spec sec.10): the snapshot's `norm` values are already oriented so
 * higher == better, and 100*exp(-d/s) means d=0 -> 100. Higher output = more similar.
 * No inversion is needed anywhere.
 */

import type { RawSimilarity, SimMeta, SimTown } from "./types.js";

/** Features where beating the reference should not be penalized. */
export const DEFAULT_QUALITY_FEATURES = [
  "violent_crime_rate",
  "median_income",
  "affordability_ratio",
  "school_index",
  "social_assoc_rate",
  "band_salary",
  "bi_salary",
  "data_salary",
] as const;

export interface SimilarityOptions {
  oneSided?: boolean;
  qualityFeatures?: readonly string[];
  featureWeights?: Record<string, number>;
  familyWeights?: Record<string, number>;
}

export function computeRawSimilarity(
  reference: SimTown,
  candidate: SimTown,
  meta: SimMeta,
  options: SimilarityOptions = {}
): RawSimilarity {
  const {
    oneSided = true,
    qualityFeatures = DEFAULT_QUALITY_FEATURES,
    featureWeights = meta.default_feature_weights,
    familyWeights = meta.default_family_weights,
  } = options;

  const quality = new Set(qualityFeatures);
  const byFamily: RawSimilarity["byFamily"] = [];
  let weightedSum = 0;
  let weightTotal = 0;

  for (const family of meta.families) {
    const keys = meta.family_features[family] ?? [];
    let d2 = 0;
    for (const k of keys) {
      const refV = reference.norm[k];
      const candV = candidate.norm[k];
      if (refV == null || candV == null) continue;
      let diff = refV - candV;
      // norm is oriented higher==better, so diff > 0 means the candidate is worse.
      if (oneSided && quality.has(k)) diff = Math.max(0, diff);
      const w = featureWeights[k] ?? 1;
      d2 += w * diff * diff;
    }
    const scale = meta.family_scales[family] || 1;
    const score = 100 * Math.exp(-Math.sqrt(d2) / scale);
    const weight = familyWeights[family] ?? 1;
    byFamily.push({ family, score, weight });
    weightedSum += weight * score;
    weightTotal += weight;
  }

  return {
    overall: weightTotal > 0 ? weightedSum / weightTotal : 0,
    byFamily,
  };
}
