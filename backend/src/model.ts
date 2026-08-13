/**
 * Assembles the stored data + tunables into the shape the scoring engine wants.
 *
 * Automatic scores arrive through the metric registry: a category or subcriterion that
 * names a metric gets its number filled in here, so the engine never learns what
 * "similarity" or "commute" mean. Renaming a category, or pointing a different one at
 * the similarity model, needs no code change.
 */

import { db, getSetting } from "./db/index.js";
import { evaluateAll, type ModelConfig, type PropertyInput } from "../../shared/scoring/engine.js";
import { DEFAULT_DISAGREEMENT_THRESHOLD } from "../../shared/scoring/category.js";
import type { SortKey } from "../../shared/scoring/ranking.js";
import { getAdapter, getGradeScale } from "./similarity-source.js";
import { resolveMetrics } from "./metrics.js";
import type {
  Category,
  DealBreaker,
  Property,
  PropertyScore,
  RaterCombine,
  Subcriterion,
  SubcriterionScore,
} from "../../shared/types.js";

export {
  getAdapter,
  getGradeScale,
  invalidateAdapter,
  similaritySettings,
  type SimilaritySettings,
} from "./similarity-source.js";

export function loadModelConfig(): ModelConfig {
  return {
    categories: db
      .prepare("SELECT * FROM categories ORDER BY sort_order")
      .all()
      .map(toCategory),
    subcriteria: db
      .prepare("SELECT * FROM subcriteria")
      .all()
      .map(toSubcriterion),
    dealBreakers: db
      .prepare("SELECT * FROM deal_breakers")
      .all()
      .map(toDealBreaker),
    gradeScale: getGradeScale(),
    combine: getSetting<RaterCombine>("rater_combine", "average"),
    disagreementThreshold: getSetting(
      "disagreement_threshold",
      DEFAULT_DISAGREEMENT_THRESHOLD
    ),
  };
}

/** Similarity detail for one property, for the property page's breakdown panel. */
export function similarityForProperty(p: Property) {
  return getAdapter().scoreForCity(p.similarity_town ?? p.city, p.latitude, p.longitude);
}

export function buildInputs(config: ModelConfig): PropertyInput[] {
  const properties = db
    .prepare("SELECT * FROM properties ORDER BY id")
    .all() as Property[];
  const scores = db.prepare("SELECT * FROM property_scores").all() as PropertyScore[];
  const subScores = db
    .prepare("SELECT * FROM subcriteria_scores")
    .all() as SubcriterionScore[];

  const metricCats = config.categories.filter((c) => c.metric);
  const metricSubs = config.subcriteria.filter((s) => s.metric);

  return properties.map((property) => {
    const externalScores: Record<number, number | null> = {};
    const externalSubScores: Record<number, number | null> = {};

    if (metricCats.length || metricSubs.length) {
      const resolved = resolveMetrics(property);
      for (const c of metricCats) {
        externalScores[c.id] = resolved[c.metric as string] ?? null;
      }
      for (const s of metricSubs) {
        externalSubScores[s.id] = resolved[s.metric as string] ?? null;
      }
    }

    return {
      property,
      scores: scores.filter((s) => s.property_id === property.id),
      subScores: subScores.filter((s) => s.property_id === property.id),
      externalScores,
      externalSubScores,
    };
  });
}

export function evaluate(
  sort: SortKey = "overall",
  weightOverrides?: Record<number, number>
) {
  const config = loadModelConfig();
  const withOverrides: ModelConfig = weightOverrides
    ? { ...config, weightOverrides }
    : config;
  return evaluateAll(buildInputs(config), withOverrides, sort);
}

// --- row mappers: SQLite has no booleans, so normalize the 0/1 ints here ---

function toCategory(r: any): Category {
  return {
    ...r,
    enabled: !!r.enabled,
    metric: r.metric ?? null,
    single_score: !!r.single_score,
  };
}
function toSubcriterion(r: any): Subcriterion {
  return { ...r, enabled: !!r.enabled, metric: r.metric ?? null };
}
function toDealBreaker(r: any): DealBreaker {
  return { ...r, enabled: !!r.enabled };
}
