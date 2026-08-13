import { describe, expect, it } from "vitest";

import {
  DEFAULT_COMMUTE_ANCHORS,
  haversineMiles,
  minutesToScore,
  scoreLeg,
  type CommuteLeg,
  type Destination,
} from "../shared/commute/commute.js";
import { calculateCategoryScore } from "../shared/scoring/category.js";
import type { Category, Subcriterion } from "../shared/types.js";

const MARK: Destination = {
  key: "mark", label: "Mark's work",
  address: "9225 Priority Way West Dr, Indianapolis, IN 46240",
  lat: 39.9224008, lon: -86.1066417,
};
const RACHEL: Destination = {
  key: "rachel", label: "Rachel's work",
  address: "Knightstown High School, 8149 W US-40, Knightstown, IN 46148",
  lat: 39.7925966, lon: -85.5421078,
};
const WESTFIELD = { lat: 40.0428, lon: -86.1275 };

describe("haversineMiles", () => {
  it("is zero for a point against itself", () => {
    expect(haversineMiles(39.5, -86.1, 39.5, -86.1)).toBeCloseTo(0, 9);
  });

  it("is symmetric", () => {
    const a = haversineMiles(MARK.lat, MARK.lon, RACHEL.lat, RACHEL.lon);
    const b = haversineMiles(RACHEL.lat, RACHEL.lon, MARK.lat, MARK.lon);
    expect(a).toBeCloseTo(b, 9);
  });

  it("matches a known Indiana distance", () => {
    // Mark's office to Rachel's school is roughly 50 miles as the crow flies.
    const d = haversineMiles(MARK.lat, MARK.lon, RACHEL.lat, RACHEL.lon);
    expect(d).toBeGreaterThan(28);
    expect(d).toBeLessThan(34);
  });

  it("treats a degree of latitude as about 69 miles", () => {
    expect(haversineMiles(39, -86, 40, -86)).toBeCloseTo(69.1, 0);
  });
});

describe("minutesToScore", () => {
  it("gives a perfect score at the door and clamps past the last anchor", () => {
    expect(minutesToScore(0)).toBe(100);
    expect(minutesToScore(-5)).toBe(100);
    expect(minutesToScore(500)).toBe(0);
  });

  it("never increases as the drive gets longer", () => {
    let prev = Infinity;
    for (let m = 0; m <= 120; m += 0.5) {
      const s = minutesToScore(m);
      expect(s).toBeLessThanOrEqual(prev + 1e-9);
      prev = s;
    }
  });

  it("interpolates between anchors", () => {
    // Halfway between 10min/96 and 15min/92.
    expect(minutesToScore(12.5)).toBeCloseTo(94, 6);
  });

  it("hits every anchor exactly", () => {
    for (const a of DEFAULT_COMMUTE_ANCHORS) {
      expect(minutesToScore(a.minutes)).toBeCloseTo(a.score, 6);
    }
  });

  it("honors a custom curve", () => {
    const strict = [
      { minutes: 0, score: 100 },
      { minutes: 10, score: 0 },
    ];
    expect(minutesToScore(5, strict)).toBeCloseTo(50, 6);
    expect(minutesToScore(20, strict)).toBe(0);
  });
});

describe("scoreLeg", () => {
  const leg = (minutes: number, miles: number): CommuteLeg => ({
    destination: "mark", label: "Mark's work", minutes, miles,
    origin: "address", origin_label: "350 S Union St", fetched_at: "2026-08-08 00:00:00",
  });

  it("scores the real Westfield drive times we measured", () => {
    // Routed: 15.4 min to Mark's office, 65.5 min to Rachel's school.
    const mark = scoreLeg(leg(15.4, 8.7));
    const rachel = scoreLeg(leg(65.5, 49.8));
    expect(mark.score).toBeGreaterThan(90);
    expect(rachel.score).toBeLessThan(30);
  });

  it("scores on minutes, not miles — a slow short trip beats a fast long one", () => {
    const slowAndShort = scoreLeg(leg(45, 12)); // city traffic
    const fastAndLong = scoreLeg(leg(30, 40)); // open interstate
    expect(fastAndLong.score).toBeGreaterThan(slowAndShort.score);
  });

  it("carries the leg's provenance through untouched", () => {
    const r = scoreLeg(leg(20, 14));
    expect(r.origin).toBe("address");
    expect(r.origin_label).toBe("350 S Union St");
    expect(r.miles).toBe(14);
  });
});

describe("a failed lookup must not read as a great commute", () => {
  it("scores 0 minutes as perfect, which is why routing must return null on failure", () => {
    // Guards the regression: OSRM snaps unplaceable coordinates to a road and can return
    // a zero-length route. If that reached the model it would score 100 — an ideal house.
    expect(minutesToScore(0)).toBe(100);
  });

  it("leaves the category unscored when a leg is missing entirely", () => {
    const category = {
      id: 9, name: "Location", description: null, weight: 20, enabled: true,
      scoring_method: "manual" as const, metric: null, sort_order: 9,
    };
    const subs = [
      { id: 1, category_id: 9, name: "Mark", weight: 1, enabled: true, metric: "commute:mark" },
      { id: 2, category_id: 9, name: "Rachel", weight: 1, enabled: true, metric: "commute:rachel" },
    ];
    const r = calculateCategoryScore({
      category, score: undefined, subcriteria: subs, subScores: new Map(),
      externalSubScores: new Map([[1, null], [2, null]]),
    });
    expect(r.score).toBeNull();
  });
});

describe("automatically scored subcriteria", () => {
  const category: Category = {
    id: 9, name: "Location", description: null, weight: 10, enabled: true,
    scoring_method: "manual", metric: null, sort_order: 9,
  };
  const subs: Subcriterion[] = [
    { id: 1, category_id: 9, name: "Mark's commute", weight: 1, enabled: true, metric: "commute:mark" },
    { id: 2, category_id: 9, name: "Rachel's commute", weight: 1, enabled: true, metric: "commute:rachel" },
  ];

  it("fills subcriteria from their metric and averages into the category", () => {
    const r = calculateCategoryScore({
      category, score: undefined, subcriteria: subs, subScores: new Map(),
      externalSubScores: new Map([[1, 92], [2, 44]]),
    });
    expect(r.subcriteria.map((s) => s.score)).toEqual([92, 44]);
    expect(r.score).toBe(68);
    expect(r.subcriteria[0].metric).toBe("commute:mark");
  });

  it("respects subcriterion weights", () => {
    const weighted = [{ ...subs[0], weight: 3 }, subs[1]];
    const r = calculateCategoryScore({
      category, score: undefined, subcriteria: weighted, subScores: new Map(),
      externalSubScores: new Map([[1, 100], [2, 0]]),
    });
    expect(r.score).toBe(75);
  });

  it("lets a hand-entered score overrule the computed one", () => {
    const r = calculateCategoryScore({
      category, score: undefined, subcriteria: subs,
      subScores: new Map([
        [1, { property_id: 1, subcriterion_id: 1, score: null, mark_score: 30, rachel_score: 30 }],
      ]),
      externalSubScores: new Map([[1, 92], [2, 44]]),
    });
    expect(r.subcriteria[0].score).toBe(30);
    expect(r.subcriteria[0].computed_score).toBe(92);
    expect(r.score).toBe(37);
  });

  it("leaves a subcriterion unscored when its metric resolves to nothing", () => {
    // e.g. the property's town couldn't be matched, or the destination was deleted.
    const r = calculateCategoryScore({
      category, score: undefined, subcriteria: subs, subScores: new Map(),
      externalSubScores: new Map([[1, 92], [2, null]]),
    });
    expect(r.subcriteria[1].score).toBeNull();
    expect(r.score).toBe(92); // unscored subcriteria drop out rather than counting as 0
  });
});
