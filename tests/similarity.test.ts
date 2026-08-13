import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  IndianaSimilarityAdapter,
  DEFAULT_REFERENCE_TOWN,
} from "../shared/similarity/adapter.js";
import { SimilarityCurve, DEFAULT_CURVE_ANCHORS } from "../shared/similarity/curve.js";
import { computeRawSimilarity } from "../shared/similarity/similarity.js";
import type { SimMeta, SimTown } from "../shared/similarity/types.js";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "similarity");
const towns: SimTown[] = JSON.parse(readFileSync(join(DATA, "towns.json"), "utf8"));
const meta: SimMeta = JSON.parse(readFileSync(join(DATA, "meta.json"), "utf8"));
const byName = (n: string) => towns.find((t) => t.name === n)!;

describe("snapshot sanity", () => {
  it("has the reference town and a full state's worth of peers", () => {
    expect(towns.length).toBeGreaterThan(200);
    expect(byName(DEFAULT_REFERENCE_TOWN)).toBeTruthy();
  });
});

describe("computeRawSimilarity direction (spec sec.10)", () => {
  const westfield = byName("Westfield");

  it("scores a town against itself at 100 — higher means MORE similar", () => {
    const r = computeRawSimilarity(westfield, westfield, meta);
    expect(r.overall).toBeCloseTo(100, 6);
  });

  it("ranks Hamilton County peers above the far corners of the state", () => {
    const fishers = computeRawSimilarity(westfield, byName("Fishers"), meta).overall;
    const attica = computeRawSimilarity(westfield, byName("Attica"), meta).overall;
    expect(fishers).toBeGreaterThan(attica);
  });

  it("never leaves the 0-100 range", () => {
    for (const t of towns) {
      const s = computeRawSimilarity(westfield, t, meta).overall;
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });
});

describe("one-sided quality features", () => {
  const westfield = byName("Westfield");
  const zionsville = byName("Zionsville");

  it("stops penalizing a town for being safer than the reference", () => {
    // Zionsville's violent crime rate is ~15/100k vs Westfield's ~81 — five times safer.
    expect(zionsville.raw.violent_crime_rate!).toBeLessThan(
      westfield.raw.violent_crime_rate!
    );
    const twoSided = computeRawSimilarity(westfield, zionsville, meta, { oneSided: false });
    const oneSided = computeRawSimilarity(westfield, zionsville, meta, { oneSided: true });

    const safetyTwo = twoSided.byFamily.find((f) => f.family === "Safety")!.score;
    const safetyOne = oneSided.byFamily.find((f) => f.family === "Safety")!.score;
    expect(safetyTwo).toBeLessThan(30);
    expect(safetyOne).toBeCloseTo(100, 6);
    expect(oneSided.overall).toBeGreaterThan(twoSided.overall);
  });

  it("still penalizes a town for being worse on a quality feature", () => {
    const worse = towns.find(
      (t) => (t.norm.school_index ?? 0) < (westfield.norm.school_index ?? 0) - 1
    )!;
    const oneSided = computeRawSimilarity(westfield, worse, meta, { oneSided: true });
    expect(oneSided.byFamily.find((f) => f.family === "Schools")!.score).toBeLessThan(100);
  });

  it("leaves character features two-sided — a much bigger town is not 'better'", () => {
    const indy = towns.find((t) => t.name === "Indianapolis") ?? byName("Fort Wayne");
    expect(indy.raw.population!).toBeGreaterThan(westfield.raw.population!);
    const oneSided = computeRawSimilarity(westfield, indy, meta, { oneSided: true });
    expect(oneSided.byFamily.find((f) => f.family === "Size")!.score).toBeLessThan(100);
  });

  it("never scores lower than the two-sided metric", () => {
    for (const t of towns) {
      const two = computeRawSimilarity(westfield, t, meta, { oneSided: false }).overall;
      const one = computeRawSimilarity(westfield, t, meta, { oneSided: true }).overall;
      expect(one).toBeGreaterThanOrEqual(two - 1e-9);
    }
  });
});

describe("SimilarityCurve", () => {
  const peers = [10, 20, 30, 40, 50, 60, 70, 80, 88];
  const curve = new SimilarityCurve(peers);

  it("puts the top peer at the A+ floor and the reference at 100", () => {
    expect(curve.aPlusRaw).toBe(88);
    expect(curve.toScore(88)).toBeCloseTo(97, 6);
    expect(curve.toScore(100)).toBeCloseTo(100, 6);
  });

  it("is monotonic — more similar never grades worse", () => {
    let prev = -Infinity;
    for (let raw = 0; raw <= 100; raw += 0.25) {
      const s = curve.toScore(raw);
      expect(s).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = s;
    }
  });

  it("computes percentiles against the peer set", () => {
    expect(curve.percentileOf(10)).toBeCloseTo(0, 6);
    expect(curve.percentileOf(50)).toBeCloseTo((100 * 4) / 9, 6);
    expect(curve.percentileOf(999)).toBeCloseTo(100, 6);
  });

  it("honors custom anchors", () => {
    const flat = new SimilarityCurve(peers, {
      anchors: [
        { percentile: 0, score: 0 },
        { percentile: 100, score: 90 },
      ],
    });
    expect(flat.toScore(10)).toBeCloseTo(0, 6);
    expect(flat.toScore(50)).toBeCloseTo((100 * 4) / 9 * 0.9, 6);
  });

  it("respects an explicit A+ anchor", () => {
    const pinned = new SimilarityCurve(peers, { aPlusRaw: 60 });
    expect(pinned.toScore(60)).toBeCloseTo(97, 6);
    expect(pinned.toScore(70)).toBeGreaterThan(97);
  });

  it("uses the default anchors when none are supplied", () => {
    expect(curve.anchors).toEqual(DEFAULT_CURVE_ANCHORS);
  });
});

describe("IndianaSimilarityAdapter on real data", () => {
  const adapter = new IndianaSimilarityAdapter(towns, meta);

  it("gives Westfield itself a perfect score and an A+", () => {
    const r = adapter.similarityFor(byName("Westfield"));
    expect(r.raw).toBeCloseTo(100, 6);
    expect(r.score).toBeCloseTo(100, 6);
    expect(r.grade).toBe("A+");
    expect(r.isReference).toBe(true);
  });

  it("puts Fishers at the top of the peer list with an A+", () => {
    const scored = adapter.allScored().filter((t) => !t.isReference);
    expect(scored[0].town).toBe("Fishers");
    expect(scored[0].grade).toBe("A+");
  });

  it("rescues Zionsville from the F it got under the two-sided metric", () => {
    const twoSided = new IndianaSimilarityAdapter(towns, meta, { oneSided: false });
    const before = twoSided.similarityFor(byName("Zionsville"));
    const after = adapter.similarityFor(byName("Zionsville"));

    expect(before.percentile).toBeLessThan(70);
    expect(after.percentile).toBeGreaterThan(80);
    expect(after.score).toBeGreaterThan(before.score);
    expect(["A+", "A", "A-", "B+", "B"]).toContain(after.grade);
  });

  it("spreads the state across the whole scale instead of piling up at F", () => {
    const hist = adapter.gradeDistribution();
    const total = hist.reduce((a, h) => a + h.count, 0);
    const fCount = hist.find((h) => h.grade === "F")!.count;
    expect(total).toBe(towns.length - 1);
    expect(fCount / total).toBeLessThan(0.15);
    // At least eight distinct letter grades are actually in use.
    expect(hist.filter((h) => h.count > 0).length).toBeGreaterThanOrEqual(8);
  });

  it("preserves the ordering of the raw metric after curving", () => {
    const scored = adapter.allScored();
    for (let i = 1; i < scored.length; i++) {
      expect(scored[i - 1].score).toBeGreaterThanOrEqual(scored[i].score - 1e-9);
    }
  });

  it("matches town names loosely and by coordinates", () => {
    expect(adapter.matchTown("westfield")!.name).toBe("Westfield");
    expect(adapter.matchTown("City of Carmel")!.name).toBe("Carmel");
    expect(adapter.matchTown("Nowhere, USA")).toBeNull();
    const w = byName("Westfield");
    expect(adapter.matchTown(null, w.lat + 0.01, w.lon + 0.01)!.name).toBe("Westfield");
    // Well outside Indiana: no match rather than a nonsense nearest-town guess.
    expect(adapter.matchTown(null, 34.05, -118.24)).toBeNull();
  });

  it("throws a clear error when the reference town is not in the dataset", () => {
    expect(() => new IndianaSimilarityAdapter(towns, meta, { referenceTown: "Atlantis" }))
      .toThrow(/not in the similarity dataset/);
  });

  it("can re-anchor on a different reference town", () => {
    const gary = new IndianaSimilarityAdapter(towns, meta, { referenceTown: "Gary" });
    expect(gary.similarityFor(byName("Gary")).score).toBeCloseTo(100, 6);
    expect(gary.summary().reference).toBe("Gary");
  });
});
