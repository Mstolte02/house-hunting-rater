/**
 * Numeric score <-> letter grade.
 *
 * Grades are strictly a presentation layer: nothing in the model ever does arithmetic
 * on a letter. Every calculation runs on the underlying 0-100 value and converts to a
 * letter only at the edge.
 */

export interface GradeBand {
  grade: string;
  /** Inclusive lower bound. The band runs up to the next band's min (exclusive). */
  min: number;
}

/** Conventional school scale. Editable at runtime from the Tuning page. */
export const DEFAULT_GRADE_SCALE: GradeBand[] = [
  { grade: "A+", min: 97 },
  { grade: "A", min: 93 },
  { grade: "A-", min: 90 },
  { grade: "B+", min: 87 },
  { grade: "B", min: 83 },
  { grade: "B-", min: 80 },
  { grade: "C+", min: 77 },
  { grade: "C", min: 73 },
  { grade: "C-", min: 70 },
  { grade: "D+", min: 67 },
  { grade: "D", min: 63 },
  { grade: "D-", min: 60 },
  { grade: "F", min: 0 },
];

function sorted(scale: GradeBand[]): GradeBand[] {
  return [...scale].sort((a, b) => b.min - a.min);
}

export function scoreToGrade(
  score: number | null | undefined,
  scale: GradeBand[] = DEFAULT_GRADE_SCALE
): string | null {
  if (score == null || Number.isNaN(score)) return null;
  const bands = sorted(scale);
  for (const band of bands) {
    if (score >= band.min) return band.grade;
  }
  // Only reachable if the scale has no floor band; treat as the lowest defined grade.
  return bands[bands.length - 1]?.grade ?? null;
}

/**
 * Inverse of scoreToGrade: the [min, max) span a letter covers. The top band's max is
 * 100 (inclusive), which the UI uses to draw the grading scale.
 */
export function gradeToScoreRange(
  grade: string,
  scale: GradeBand[] = DEFAULT_GRADE_SCALE
): { min: number; max: number } | null {
  const bands = sorted(scale);
  const i = bands.findIndex((b) => b.grade === grade);
  if (i === -1) return null;
  return { min: bands[i].min, max: i === 0 ? 100 : bands[i - 1].min };
}

/** Grade-point value, used only for display/sorting — never fed back into the model. */
export function gradeToPoints(grade: string): number | null {
  const table: Record<string, number> = {
    "A+": 4.3, A: 4.0, "A-": 3.7,
    "B+": 3.3, B: 3.0, "B-": 2.7,
    "C+": 2.3, C: 2.0, "C-": 1.7,
    "D+": 1.3, D: 1.0, "D-": 0.7,
    F: 0.0,
  };
  return table[grade] ?? null;
}
