/**
 * The scoring engine's public surface: property data in, ranked results out.
 *
 * Deliberately knows nothing about Indiana Similarity, SQLite, HTTP or React. Automatic
 * category scores arrive as a plain `externalScores` map keyed by category id, so the
 * similarity model is just one possible supplier and the engine stays free of any
 * property- or category-specific logic. The same code runs on the server (for stored
 * results) and in the browser (for the Tuning page's live weight preview).
 */

import type {
  Category,
  CategoryResult,
  DealBreaker,
  Property,
  PropertyResult,
  PropertyScore,
  RaterCombine,
  Subcriterion,
  SubcriterionScore,
} from "../types.js";
import { calculateCategoryScore, DEFAULT_DISAGREEMENT_THRESHOLD } from "./category.js";
import { applyDealBreakers } from "./dealbreakers.js";
import { DEFAULT_GRADE_SCALE, type GradeBand } from "./grade.js";
import { calculateOverallScore } from "./overall.js";
import { calculateRanking, type SortKey } from "./ranking.js";

export interface ModelConfig {
  categories: Category[];
  subcriteria: Subcriterion[];
  dealBreakers?: DealBreaker[];
  gradeScale?: GradeBand[];
  combine?: RaterCombine;
  disagreementThreshold?: number;
  /**
   * Per-category weight overrides (category id -> weight). The Tuning page and model
   * presets both use this to preview a different weighting without touching the DB.
   */
  weightOverrides?: Record<number, number>;
}

export interface PropertyInput {
  property: Property;
  scores: PropertyScore[];
  subScores: SubcriterionScore[];
  /** category id -> automatically supplied 0-100 score (e.g. Indiana Similarity). */
  externalScores?: Record<number, number | null>;
  /** subcriterion id -> automatically supplied 0-100 score (e.g. a commute distance). */
  externalSubScores?: Record<number, number | null>;
}

export function evaluateProperty(
  input: PropertyInput,
  config: ModelConfig
): PropertyResult {
  const {
    categories,
    subcriteria,
    dealBreakers = [],
    gradeScale = DEFAULT_GRADE_SCALE,
    combine = "average",
    disagreementThreshold = DEFAULT_DISAGREEMENT_THRESHOLD,
    weightOverrides,
  } = config;

  const scoreByCat = new Map(input.scores.map((s) => [s.category_id, s]));
  const subScoreById = new Map(input.subScores.map((s) => [s.subcriterion_id, s]));
  const externalSubScores = new Map(
    Object.entries(input.externalSubScores ?? {}).map(([k, v]) => [Number(k), v])
  );

  const results: CategoryResult[] = categories
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((category) => {
      const weight = weightOverrides?.[category.id] ?? category.weight;
      return calculateCategoryScore({
        category: { ...category, weight },
        score: scoreByCat.get(category.id),
        subcriteria: subcriteria.filter((s) => s.category_id === category.id),
        subScores: subScoreById,
        externalScore: input.externalScores?.[category.id] ?? null,
        externalSubScores,
        combine,
        gradeScale,
        disagreementThreshold,
      });
    });

  const { overall, grade, contributions, effective_weight } = calculateOverallScore(
    results,
    gradeScale
  );

  return {
    property: input.property,
    categories: results,
    overall,
    grade,
    contributions,
    effective_weight,
    failed_deal_breakers: applyDealBreakers(
      input.property,
      results,
      overall,
      dealBreakers
    ),
    rank: null,
  };
}

export function evaluateAll(
  inputs: PropertyInput[],
  config: ModelConfig,
  sort: SortKey = "overall"
): PropertyResult[] {
  return calculateRanking(
    inputs.map((i) => evaluateProperty(i, config)),
    sort
  );
}

export * from "./grade.js";
export * from "./category.js";
export * from "./overall.js";
export * from "./ranking.js";
export * from "./dealbreakers.js";
