/**
 * Weighted overall score, plus the line-by-line breakdown that explains it.
 *
 * Weights are normalized by the total weight of the categories that actually counted,
 * so disabling a category or leaving one unscored re-weights the rest instead of
 * silently dragging the score toward zero.
 */

import type { CategoryResult, ContributionLine } from "../types.js";
import { DEFAULT_GRADE_SCALE, scoreToGrade, type GradeBand } from "./grade.js";

export interface OverallResult {
  overall: number | null;
  grade: string | null;
  contributions: ContributionLine[];
  /** Sum of the weights that participated — what the breakdown normalizes against. */
  effective_weight: number;
}

export function calculateOverallScore(
  categories: CategoryResult[],
  gradeScale: GradeBand[] = DEFAULT_GRADE_SCALE
): OverallResult {
  const counted = categories.filter(
    (c) => c.enabled && c.score != null && c.weight > 0
  );
  const effective_weight = counted.reduce((a, c) => a + c.weight, 0);

  if (effective_weight <= 0) {
    return { overall: null, grade: null, contributions: [], effective_weight: 0 };
  }

  const contributions: ContributionLine[] = counted.map((c) => {
    const normalized_weight = c.weight / effective_weight;
    return {
      name: c.name,
      score: c.score as number,
      weight: c.weight,
      normalized_weight,
      contribution: (c.score as number) * normalized_weight,
    };
  });

  const overall = contributions.reduce((a, l) => a + l.contribution, 0);
  return {
    overall,
    grade: scoreToGrade(overall, gradeScale),
    contributions,
    effective_weight,
  };
}

/** Does the configured weight set add up the way the UI claims it does? */
export function weightTotal(categories: { weight: number; enabled: boolean }[]): number {
  return categories.filter((c) => c.enabled).reduce((a, c) => a + c.weight, 0);
}
