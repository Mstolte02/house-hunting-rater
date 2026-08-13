import { describe, expect, it } from "vitest";

import {
  DEFAULT_GRADE_SCALE,
  gradeToScoreRange,
  scoreToGrade,
} from "../shared/scoring/grade.js";

describe("scoreToGrade", () => {
  it("maps the spec's boundaries exactly", () => {
    const cases: [number, string][] = [
      [100, "A+"], [97, "A+"], [96.99, "A"], [93, "A"], [92.99, "A-"], [90, "A-"],
      [89.99, "B+"], [87, "B+"], [86.99, "B"], [83, "B"], [82.99, "B-"], [80, "B-"],
      [79.99, "C+"], [77, "C+"], [76.99, "C"], [73, "C"], [72.99, "C-"], [70, "C-"],
      [69.99, "D+"], [67, "D+"], [66.99, "D"], [63, "D"], [62.99, "D-"], [60, "D-"],
      [59.99, "F"], [0, "F"],
    ];
    for (const [score, grade] of cases) {
      expect(scoreToGrade(score), `${score} should be ${grade}`).toBe(grade);
    }
  });

  it("returns null for missing scores rather than inventing an F", () => {
    expect(scoreToGrade(null)).toBeNull();
    expect(scoreToGrade(undefined)).toBeNull();
    expect(scoreToGrade(NaN)).toBeNull();
  });

  it("honors a custom scale", () => {
    const harsh = [
      { grade: "A", min: 90 },
      { grade: "B", min: 80 },
      { grade: "F", min: 0 },
    ];
    expect(scoreToGrade(85, harsh)).toBe("B");
    expect(scoreToGrade(95, harsh)).toBe("A");
    expect(scoreToGrade(10, harsh)).toBe("F");
  });
});

describe("gradeToScoreRange", () => {
  it("inverts scoreToGrade", () => {
    for (const band of DEFAULT_GRADE_SCALE) {
      const range = gradeToScoreRange(band.grade);
      expect(range).not.toBeNull();
      expect(scoreToGrade(range!.min)).toBe(band.grade);
    }
  });

  it("caps the top band at 100", () => {
    expect(gradeToScoreRange("A+")).toEqual({ min: 97, max: 100 });
  });

  it("returns null for a grade outside the scale", () => {
    expect(gradeToScoreRange("Z")).toBeNull();
  });
});
