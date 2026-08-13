/**
 * Category scoring: two raters -> one number, subcriteria -> category score, overrides.
 */

import type {
  Category,
  CategoryResult,
  RatedScore,
  RaterCombine,
  Subcriterion,
  SubcriterionResult,
  SubcriterionScore,
  PropertyScore,
} from "../types.js";
import { DEFAULT_GRADE_SCALE, scoreToGrade, type GradeBand } from "./grade.js";

/** Gap between Mark and Rachel at or above which the UI flags "worth talking about". */
export const DEFAULT_DISAGREEMENT_THRESHOLD = 15;

export interface CombineResult {
  score: number | null;
  mark: number | null;
  rachel: number | null;
  agreement: number | null;
  disagreement: boolean;
}

/**
 * Collapse a rated value into a single 0-100 score.
 *
 * Precedence: if either Mark or Rachel entered a score, the pair wins — that is the
 * whole point of rating separately. The plain `score` field is the fallback for
 * categories nobody split (formula-driven ones, or where you just agreed on a number).
 */
export function combineRaters(
  rated: RatedScore,
  combine: RaterCombine = "average",
  disagreementThreshold = DEFAULT_DISAGREEMENT_THRESHOLD
): CombineResult {
  const mark = numOrNull(rated.mark_score);
  const rachel = numOrNull(rated.rachel_score);
  const solo = numOrNull(rated.score);

  const agreement = mark != null && rachel != null ? Math.abs(mark - rachel) : null;
  const disagreement = agreement != null && agreement >= disagreementThreshold;

  let score: number | null;
  if (mark != null && rachel != null) {
    score =
      combine === "min"
        ? Math.min(mark, rachel)
        : combine === "max"
        ? Math.max(mark, rachel)
        : (mark + rachel) / 2;
  } else if (mark != null || rachel != null) {
    score = mark ?? rachel;
  } else {
    score = solo;
  }

  return { score, mark, rachel, agreement, disagreement };
}

/** Weighted mean of the enabled, actually-scored subcriteria. Null if none are scored. */
export function combineSubcriteria(
  results: SubcriterionResult[]
): number | null {
  let sum = 0;
  let weight = 0;
  for (const r of results) {
    if (r.score == null) continue;
    const w = r.weight > 0 ? r.weight : 0;
    if (w === 0) continue;
    sum += r.score * w;
    weight += w;
  }
  return weight > 0 ? sum / weight : null;
}

export interface CategoryScoreInput {
  category: Category;
  score: PropertyScore | undefined;
  subcriteria: Subcriterion[];
  subScores: Map<number, SubcriterionScore>;
  /** Score supplied by an automatic source (e.g. Indiana Similarity) for this category. */
  externalScore?: number | null;
  /** Automatic scores for individual subcriteria, keyed by subcriterion id. */
  externalSubScores?: Map<number, number | null>;
  combine?: RaterCombine;
  gradeScale?: GradeBand[];
  disagreementThreshold?: number;
}

/**
 * Resolve one category to a 0-100 score.
 *
 * Order of precedence, highest first:
 *   1. manual override (always surfaced in the UI, never silent)
 *   2. subcriteria weighted mean, when any subcriterion is scored
 *   3. the category's own Mark/Rachel/solo score
 *   4. an external/automatic score (Indiana Similarity, affordability formula)
 */
export function calculateCategoryScore(input: CategoryScoreInput): CategoryResult {
  const {
    category,
    score,
    subcriteria,
    subScores,
    externalScore = null,
    externalSubScores,
    combine = "average",
    gradeScale = DEFAULT_GRADE_SCALE,
    disagreementThreshold = DEFAULT_DISAGREEMENT_THRESHOLD,
  } = input;

  const subResults: SubcriterionResult[] = subcriteria
    .filter((s) => s.enabled)
    .map((s) => {
      const raw = subScores.get(s.id);
      const c = combineRaters(
        raw ?? { score: null, mark_score: null, rachel_score: null },
        combine,
        disagreementThreshold
      );
      // Same precedence as a category: anything entered by hand beats the automatic
      // value, so you can always overrule a computed commute for a given house.
      const computed = numOrNull(externalSubScores?.get(s.id) ?? null);
      const score = c.score ?? computed;
      return {
        subcriterion_id: s.id,
        name: s.name,
        weight: s.weight,
        score,
        grade: scoreToGrade(score, gradeScale),
        mark_score: c.mark,
        rachel_score: c.rachel,
        agreement: c.agreement,
        metric: s.metric ?? null,
        computed_score: computed,
      };
    });

  const own = combineRaters(
    score ?? { score: null, mark_score: null, rachel_score: null },
    combine,
    disagreementThreshold
  );
  const fromSubs = combineSubcriteria(subResults);

  const computed = fromSubs ?? own.score ?? numOrNull(externalScore);
  const override = numOrNull(score?.override_score);
  const final = override ?? computed;

  return {
    category_id: category.id,
    name: category.name,
    weight: category.weight,
    enabled: category.enabled,
    score: final,
    grade: scoreToGrade(final, gradeScale),
    computed_score: computed,
    external_score: numOrNull(externalScore),
    single_score: category.single_score === true,
    overridden: override != null,
    override_reason: score?.override_reason ?? null,
    mark_score: own.mark,
    rachel_score: own.rachel,
    agreement: own.agreement,
    disagreement_flag: own.disagreement,
    subcriteria: subResults,
  };
}

function numOrNull(v: number | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
