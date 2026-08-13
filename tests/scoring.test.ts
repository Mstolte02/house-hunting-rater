import { describe, expect, it } from "vitest";

import { combineRaters, combineSubcriteria, calculateCategoryScore } from "../shared/scoring/category.js";
import { calculateOverallScore } from "../shared/scoring/overall.js";
import { calculateRanking } from "../shared/scoring/ranking.js";
import { applyDealBreakers } from "../shared/scoring/dealbreakers.js";
import { evaluateAll, evaluateProperty } from "../shared/scoring/engine.js";
import type {
  Category,
  CategoryResult,
  DealBreaker,
  Property,
  PropertyResult,
} from "../shared/types.js";

const cat = (id: number, name: string, weight: number, extra: Partial<Category> = {}): Category => ({
  id, name, description: null, weight, enabled: true,
  scoring_method: "manual", sort_order: id, ...extra,
});

const prop = (id: number, extra: Partial<Property> = {}): Property =>
  ({
    id, name: `Property ${id}`, address: null, city: "Westfield", state: "IN", zip: null,
    url: null, property_type: "House", status: "Considering", monthly_cost: 2000,
    hoa: null, property_taxes: null, insurance: null, utilities: null, deposit: null,
    move_in_costs: null, bedrooms: 3, bathrooms: 2, square_feet: 1800, lot_size: null,
    year_built: null, garage_spaces: null, parking: null, latitude: null, longitude: null,
    similarity_town: null, notes: null, pros: null, cons: null, visit_notes: null,
    created_at: "2026-01-01 00:00:00", updated_at: "2026-01-01 00:00:00", ...extra,
  }) as Property;

const noScore = { score: null, mark_score: null, rachel_score: null };

describe("combineRaters (Mark/Rachel)", () => {
  it("averages by default", () => {
    const r = combineRaters({ ...noScore, mark_score: 92, rachel_score: 71 });
    expect(r.score).toBe(81.5);
    expect(r.agreement).toBe(21);
    expect(r.disagreement).toBe(true);
  });

  it("supports min for deal-breaker-ish categories and max for enthusiasm", () => {
    const both = { ...noScore, mark_score: 92, rachel_score: 71 };
    expect(combineRaters(both, "min").score).toBe(71);
    expect(combineRaters(both, "max").score).toBe(92);
  });

  it("does not flag small gaps", () => {
    const r = combineRaters({ ...noScore, mark_score: 88, rachel_score: 82 });
    expect(r.agreement).toBe(6);
    expect(r.disagreement).toBe(false);
  });

  it("uses whichever rater scored when only one did", () => {
    expect(combineRaters({ ...noScore, mark_score: 80 }).score).toBe(80);
    expect(combineRaters({ ...noScore, rachel_score: 60 }).score).toBe(60);
  });

  it("falls back to the solo score, and rater scores take precedence over it", () => {
    expect(combineRaters({ ...noScore, score: 75 }).score).toBe(75);
    expect(
      combineRaters({ score: 75, mark_score: 90, rachel_score: 90 }).score
    ).toBe(90);
  });

  it("reports no agreement when only one person rated", () => {
    expect(combineRaters({ ...noScore, mark_score: 80 }).agreement).toBeNull();
  });
});

describe("combineSubcriteria", () => {
  const sub = (name: string, weight: number, score: number | null) => ({
    subcriterion_id: 1, name, weight, score, grade: null,
    mark_score: null, rachel_score: null, agreement: null,
  });

  it("weights subscores", () => {
    // (90*2 + 60*1) / 3 = 80
    expect(combineSubcriteria([sub("Layout", 2, 90), sub("Kitchen", 1, 60)])).toBe(80);
  });

  it("ignores unscored subcriteria instead of treating them as zero", () => {
    expect(combineSubcriteria([sub("Layout", 1, 90), sub("Kitchen", 1, null)])).toBe(90);
  });

  it("returns null when nothing is scored", () => {
    expect(combineSubcriteria([sub("Layout", 1, null)])).toBeNull();
  });
});

describe("calculateCategoryScore precedence", () => {
  const base = {
    category: cat(1, "House", 15),
    subcriteria: [],
    subScores: new Map(),
  };

  it("prefers subcriteria over the category's own score", () => {
    const r = calculateCategoryScore({
      ...base,
      category: cat(1, "House", 15),
      subcriteria: [{ id: 7, category_id: 1, name: "Layout", weight: 1, enabled: true }],
      subScores: new Map([[7, { property_id: 1, subcriterion_id: 7, score: 95, mark_score: null, rachel_score: null }]]),
      score: { property_id: 1, category_id: 1, score: 50, mark_score: null, rachel_score: null, override_score: null, override_reason: null, notes: null },
    });
    expect(r.score).toBe(95);
  });

  it("uses the external score only when nothing manual exists", () => {
    expect(calculateCategoryScore({ ...base, score: undefined, externalScore: 88 }).score).toBe(88);
    expect(
      calculateCategoryScore({
        ...base,
        externalScore: 88,
        score: { property_id: 1, category_id: 1, score: 40, mark_score: null, rachel_score: null, override_score: null, override_reason: null, notes: null },
      }).score
    ).toBe(40);
  });

  it("applies an override on top of everything and keeps the computed value visible", () => {
    const r = calculateCategoryScore({
      ...base,
      externalScore: 91,
      score: { property_id: 1, category_id: 1, score: null, mark_score: null, rachel_score: null, override_score: 95, override_reason: "Five minutes from Rachel's parents", notes: null },
    });
    expect(r.score).toBe(95);
    expect(r.computed_score).toBe(91);
    expect(r.overridden).toBe(true);
    expect(r.override_reason).toContain("Rachel's parents");
  });
});

describe("external_score is exposed for live recalculation", () => {
  // The property page recomputes while you type by re-running calculateCategoryScore
  // with the automatic value. That only works if the raw external value survives on the
  // result — computed_score reflects the manual entry once one exists.
  const base = {
    category: cat(1, "Westfield Similarity", 10, { scoring_method: "external" as const }),
    subcriteria: [],
    subScores: new Map(),
    externalScore: 74.8,
  };

  it("keeps the automatic value visible after a manual score overrides it", () => {
    const r = calculateCategoryScore({
      ...base,
      score: { property_id: 1, category_id: 1, score: null, mark_score: 90, rachel_score: 80, override_score: null, override_reason: null, notes: null },
    });
    expect(r.score).toBe(85);
    expect(r.computed_score).toBe(85);
    expect(r.external_score).toBe(74.8);
  });

  it("falls back to the automatic value when the raters are cleared", () => {
    const r = calculateCategoryScore({ ...base, score: undefined });
    expect(r.score).toBe(74.8);
    expect(r.external_score).toBe(74.8);
  });

  it("is null for a purely manual category", () => {
    const r = calculateCategoryScore({
      category: cat(2, "Safety", 20), subcriteria: [], subScores: new Map(),
      score: { property_id: 1, category_id: 2, score: null, mark_score: 70, rachel_score: 70, override_score: null, override_reason: null, notes: null },
    });
    expect(r.external_score).toBeNull();
    expect(r.score).toBe(70);
  });

  it("recomputes to the same number the server would save", () => {
    // One rater typed, the other blank — the half-entered state the UI shows live.
    const typed = calculateCategoryScore({
      ...base,
      score: { property_id: 1, category_id: 1, score: null, mark_score: 88, rachel_score: null, override_score: null, override_reason: null, notes: null },
    });
    expect(typed.score).toBe(88);
    expect(typed.agreement).toBeNull();
  });
});

describe("calculateOverallScore", () => {
  const result = (name: string, weight: number, score: number | null, enabled = true): CategoryResult => ({
    category_id: 0, name, weight, enabled, score, grade: null, computed_score: score,
    overridden: false, override_reason: null, mark_score: null, rachel_score: null,
    agreement: null, disagreement_flag: false, subcriteria: [],
  });

  it("computes the spec's worked example", () => {
    // sec.35: 95/82/94/91/97/84/88/90 at 20/20/15/15/10/7.5/7.5/5
    const r = calculateOverallScore([
      result("Location", 20, 95), result("Affordability", 20, 82),
      result("Property", 15, 94), result("Neighborhood", 15, 91),
      result("Commute", 10, 97), result("Amenities", 7.5, 84),
      result("Condition", 7.5, 88), result("Intangibles", 5, 90),
    ]);
    expect(r.overall).toBeCloseTo(90.3, 1);
    expect(r.grade).toBe("A-");
    expect(r.effective_weight).toBe(100);
  });

  it("is not the average of the letter grades", () => {
    // An A (95) at 90% weight and an F (50) at 10% is still an A-, not a C.
    const r = calculateOverallScore([result("Big", 90, 95), result("Small", 10, 50)]);
    expect(r.overall).toBeCloseTo(90.5, 1);
  });

  it("re-normalizes when a category is disabled or unscored", () => {
    const r = calculateOverallScore([
      result("A", 50, 90), result("B", 50, 70, false), result("C", 50, null),
    ]);
    expect(r.overall).toBe(90);
    expect(r.effective_weight).toBe(50);
  });

  it("returns null rather than 0 when nothing counts", () => {
    const r = calculateOverallScore([result("A", 20, null)]);
    expect(r.overall).toBeNull();
    expect(r.grade).toBeNull();
  });

  it("contributions sum to the overall", () => {
    const r = calculateOverallScore([result("A", 20, 95), result("B", 30, 60)]);
    const sum = r.contributions.reduce((a, c) => a + c.contribution, 0);
    expect(sum).toBeCloseTo(r.overall!, 10);
  });
});

describe("applyDealBreakers", () => {
  const dbk = (over: Partial<DealBreaker>): DealBreaker => ({
    id: 1, label: "Too expensive", field: "monthly_cost", comparator: "max",
    value: 2500, enabled: true, ...over,
  });

  it("fails a max breach and passes within budget", () => {
    expect(applyDealBreakers(prop(1, { monthly_cost: 3200 }), [], 90, [dbk({})])).toEqual(["Too expensive"]);
    expect(applyDealBreakers(prop(1, { monthly_cost: 2400 }), [], 90, [dbk({})])).toEqual([]);
  });

  it("fails a min breach", () => {
    const min = dbk({ label: "Too small", field: "bedrooms", comparator: "min", value: 3 });
    expect(applyDealBreakers(prop(1, { bedrooms: 2 }), [], 90, [min])).toEqual(["Too small"]);
    expect(applyDealBreakers(prop(1, { bedrooms: 3 }), [], 90, [min])).toEqual([]);
  });

  it("ignores disabled rules and missing data", () => {
    expect(applyDealBreakers(prop(1, { monthly_cost: 9999 }), [], 90, [dbk({ enabled: false })])).toEqual([]);
    expect(applyDealBreakers(prop(1, { monthly_cost: null }), [], 90, [dbk({})])).toEqual([]);
  });

  it("can target the overall score and a category by name", () => {
    const cats: CategoryResult[] = [{
      category_id: 1, name: "Commute", weight: 10, enabled: true, score: 40, grade: "F",
      computed_score: 40, overridden: false, override_reason: null, mark_score: null,
      rachel_score: null, agreement: null, disagreement_flag: false, subcriteria: [],
    }];
    expect(applyDealBreakers(prop(1), cats, 55, [dbk({ label: "Score too low", field: "overall", comparator: "min", value: 60 })])).toEqual(["Score too low"]);
    expect(applyDealBreakers(prop(1), cats, 90, [dbk({ label: "Commute too rough", field: "Commute", comparator: "min", value: 50 })])).toEqual(["Commute too rough"]);
  });
});

describe("calculateRanking", () => {
  const mk = (id: number, overall: number | null, failed: string[] = [], extra: Partial<Property> = {}): PropertyResult => ({
    property: prop(id, extra), categories: [], overall, grade: null, contributions: [],
    effective_weight: 100, failed_deal_breakers: failed, rank: null,
  });

  it("ranks best first", () => {
    const ranked = calculateRanking([mk(1, 85.1), mk(2, 91.4), mk(3, 88.7)]);
    expect(ranked.map((r) => r.property.id)).toEqual([2, 3, 1]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("excludes deal-breaker failures from the ranking but keeps them in the list", () => {
    const ranked = calculateRanking([mk(1, 95, ["Too expensive"]), mk(2, 80), mk(3, 70)]);
    expect(ranked.map((r) => r.property.id)).toEqual([2, 3, 1]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, null]);
    expect(ranked).toHaveLength(3);
  });

  it("sorts unscored properties last", () => {
    const ranked = calculateRanking([mk(1, null), mk(2, 60)]);
    expect(ranked.map((r) => r.property.id)).toEqual([2, 1]);
  });

  it("sorts by price with cheaper first", () => {
    const ranked = calculateRanking(
      [mk(1, 90, [], { monthly_cost: 3000 }), mk(2, 70, [], { monthly_cost: 1800 })],
      "price"
    );
    expect(ranked.map((r) => r.property.id)).toEqual([2, 1]);
  });

  it("sorts by a named category", () => {
    const withCat = (id: number, score: number) => {
      const r = mk(id, 80);
      r.categories = [{
        category_id: 1, name: "Location", weight: 20, enabled: true, score, grade: null,
        computed_score: score, overridden: false, override_reason: null, mark_score: null,
        rachel_score: null, agreement: null, disagreement_flag: false, subcriteria: [],
      }];
      return r;
    };
    const ranked = calculateRanking([withCat(1, 70), withCat(2, 95)], { category: "Location" });
    expect(ranked.map((r) => r.property.id)).toEqual([2, 1]);
  });
});

describe("evaluateProperty / evaluateAll", () => {
  const categories = [cat(1, "Location", 20, { scoring_method: "external" }), cat(2, "Affordability", 20)];
  const config = { categories, subcriteria: [] };

  it("feeds external scores into external categories only", () => {
    const r = evaluateProperty(
      { property: prop(1), scores: [], subScores: [], externalScores: { 1: 91, 2: 91 } },
      config
    );
    expect(r.categories.find((c) => c.name === "Location")!.score).toBe(91);
    // Affordability is manual, but an external score supplied for it is still honored
    // as the last-resort fallback — the engine has no category-specific rules.
    expect(r.categories.find((c) => c.name === "Affordability")!.score).toBe(91);
  });

  it("applies weight overrides without mutating the stored categories", () => {
    const inputs = [{
      property: prop(1), subScores: [],
      scores: [
        { property_id: 1, category_id: 1, score: 100, mark_score: null, rachel_score: null, override_score: null, override_reason: null, notes: null },
        { property_id: 1, category_id: 2, score: 0, mark_score: null, rachel_score: null, override_score: null, override_reason: null, notes: null },
      ],
    }];
    const even = evaluateAll(inputs, config)[0];
    expect(even.overall).toBe(50);

    const tilted = evaluateAll(inputs, { ...config, weightOverrides: { 1: 90, 2: 10 } })[0];
    expect(tilted.overall).toBe(90);
    expect(categories[0].weight).toBe(20); // stored config untouched
  });
});
