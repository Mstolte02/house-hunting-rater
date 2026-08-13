/**
 * The Indiana Similarity snapshot and the adapter built over it.
 *
 * Split out from model.ts so both the model assembler and the metric registry can reach
 * the adapter without importing each other — metrics needs it to locate a property's
 * town, and the model needs metrics to fill automatic scores.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DATA_DIR, getSetting } from "./db/index.js";
import { DEFAULT_GRADE_SCALE, type GradeBand } from "../../shared/scoring/grade.js";
import {
  IndianaSimilarityAdapter,
  DEFAULT_REFERENCE_TOWN,
} from "../../shared/similarity/adapter.js";
import { DEFAULT_QUALITY_FEATURES } from "../../shared/similarity/similarity.js";
import { DEFAULT_CURVE_ANCHORS, type CurveAnchor } from "../../shared/similarity/curve.js";
import type { SimMeta, SimTown } from "../../shared/similarity/types.js";

const SIM_DIR = join(DATA_DIR, "similarity");

let townsCache: SimTown[] | null = null;
let metaCache: SimMeta | null = null;

function loadSnapshot(): { towns: SimTown[]; meta: SimMeta } {
  if (!townsCache || !metaCache) {
    try {
      townsCache = JSON.parse(readFileSync(join(SIM_DIR, "towns.json"), "utf8"));
      metaCache = JSON.parse(readFileSync(join(SIM_DIR, "meta.json"), "utf8"));
    } catch (e) {
      throw new Error(
        `Could not read the Indiana Similarity snapshot in ${SIM_DIR}. ` +
          `Run "npm run refresh-similarity" from the project root. (${String(e)})`
      );
    }
  }
  return { towns: townsCache as SimTown[], meta: metaCache as SimMeta };
}

export interface SimilaritySettings {
  referenceTown: string;
  oneSided: boolean;
  qualityFeatures: string[];
  anchors: CurveAnchor[];
  aPlusRaw: number | null;
}

export function similaritySettings(): SimilaritySettings {
  return {
    referenceTown: getSetting("reference_town", DEFAULT_REFERENCE_TOWN),
    oneSided: getSetting("one_sided", true),
    qualityFeatures: getSetting("quality_features", [...DEFAULT_QUALITY_FEATURES]),
    anchors: getSetting("curve_anchors", DEFAULT_CURVE_ANCHORS),
    aPlusRaw: getSetting<number | null>("a_plus_raw", null),
  };
}

export function getGradeScale(): GradeBand[] {
  return getSetting("grade_scale", DEFAULT_GRADE_SCALE);
}

/** Adapters are cheap to build (208 towns) but we cache per settings signature. */
let adapterCache: { key: string; adapter: IndianaSimilarityAdapter } | null = null;

export function getAdapter(
  overrides: Partial<SimilaritySettings> = {}
): IndianaSimilarityAdapter {
  const s = { ...similaritySettings(), ...overrides };
  const gradeScale = getGradeScale();
  const key = JSON.stringify([s, gradeScale]);
  if (adapterCache?.key === key) return adapterCache.adapter;

  const { towns, meta } = loadSnapshot();
  const adapter = new IndianaSimilarityAdapter(towns, meta, {
    referenceTown: s.referenceTown,
    oneSided: s.oneSided,
    qualityFeatures: s.qualityFeatures,
    anchors: s.anchors,
    aPlusRaw: s.aPlusRaw,
    gradeScale,
  });
  adapterCache = { key, adapter };
  return adapter;
}

export function invalidateAdapter(): void {
  adapterCache = null;
}
