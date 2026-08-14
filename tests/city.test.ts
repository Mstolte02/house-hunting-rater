import { describe, expect, it } from "vitest";

import {
  cityExternals,
  evaluateCity,
  findCityProfileByName,
  normalizeCityName,
  resolveCityProfile,
} from "../shared/city/profiles.js";
import { evaluateProperty } from "../shared/scoring/engine.js";
import type {
  Category,
  CityProfile,
  CityScore,
  CitySubScore,
  Property,
  Subcriterion,
} from "../shared/types.js";

const cat = (id: number, name: string, weight: number, extra: Partial<Category> = {}): Category => ({
  id, name, description: null, weight, enabled: true, scoring_method: "manual", metric: null,
  single_score: false, city_scoped: false, sort_order: id, ...extra,
});
const sub = (id: number, category_id: number, name: string, weight: number): Subcriterion =>
  ({ id, category_id, name, weight, enabled: true, metric: null });
const city = (id: number, name: string): CityProfile =>
  ({ id, name, state: "IN", notes: null, created_at: "", updated_at: "" });
const prop = (id: number, extra: Partial<Property> = {}): Property =>
  ({
    id, name: `Property ${id}`, address: null, city: "Greenfield", state: "IN", zip: null,
    url: null, property_type: "House", status: "Considering", monthly_cost: 2000,
    hoa: null, property_taxes: null, insurance: null, utilities: null, deposit: null,
    move_in_costs: null, bedrooms: 3, bathrooms: 2, square_feet: 1800, lot_size: null,
    year_built: null, garage_spaces: null, parking: null, latitude: null, longitude: null,
    similarity_town: null, city_profile_id: null, city_ratings_manual: false, notes: null,
    pros: null, cons: null, visit_notes: null,
    created_at: "2026-01-01 00:00:00", updated_at: "2026-01-01 00:00:00", ...extra,
  }) as Property;

const SCHOOLS = cat(1, "Schools", 20, { city_scoped: true });
const LOCATION = cat(2, "Location", 30, { city_scoped: true });
const KITCHEN = cat(3, "Living Spaces", 50);
const CATEGORIES = [SCHOOLS, LOCATION, KITCHEN];
const SUBS = [sub(10, 2, "Groceries", 60), sub(11, 2, "Restaurants", 40)];

const GREENFIELD = city(1, "Greenfield");
const FORTVILLE = city(2, "Fortville");
const PROFILES = [GREENFIELD, FORTVILLE];

const cityScores: CityScore[] = [
  { city_profile_id: 1, category_id: 1, score: null, mark_score: 88, rachel_score: 88, notes: null },
  { city_profile_id: 2, category_id: 1, score: 60, mark_score: null, rachel_score: null, notes: null },
];
const citySubScores: CitySubScore[] = [
  { city_profile_id: 1, subcriterion_id: 10, score: null, mark_score: 90, rachel_score: 80 },
  { city_profile_id: 1, subcriterion_id: 11, score: null, mark_score: 100, rachel_score: 100 },
];
const model = { categories: CATEGORIES, subcriteria: SUBS, cityScores, citySubScores };

describe("normalizeCityName", () => {
  it("ignores case, spacing and punctuation so a city still matches its profile", () => {
    expect(normalizeCityName(" new PALESTINE ")).toBe("new palestine");
    expect(normalizeCityName("St. Paul")).toBe(normalizeCityName("St Paul"));
    expect(normalizeCityName(null)).toBe("");
  });

  it("does not match two different towns", () => {
    expect(findCityProfileByName(PROFILES, "greenfield")?.id).toBe(1);
    expect(findCityProfileByName(PROFILES, "Fishers")).toBeNull();
  });
});

describe("resolveCityProfile", () => {
  it("matches on the city you typed, with no extra bookkeeping", () => {
    const link = resolveCityProfile(prop(1), PROFILES);
    expect(link.source).toBe("matched");
    expect(link.profile?.name).toBe("Greenfield");
  });

  it("borrows another town when a property sits far enough out", () => {
    const link = resolveCityProfile(prop(1, { city_profile_id: 2 }), PROFILES);
    expect(link.source).toBe("borrowed");
    expect(link.profile?.name).toBe("Fortville");
  });

  it("reports a manual property as using no city at all", () => {
    const link = resolveCityProfile(prop(1, { city_ratings_manual: true, city_profile_id: 2 }), PROFILES);
    expect(link.source).toBe("manual");
    expect(link.profile).toBeNull();
  });

  it("falls back to the city name when the chosen profile is gone", () => {
    const link = resolveCityProfile(prop(1, { city_profile_id: 99 }), PROFILES);
    expect(link.source).toBe("matched");
    expect(link.profile?.id).toBe(1);
  });

  it("reports an unrated city rather than silently scoring nothing", () => {
    expect(resolveCityProfile(prop(1, { city: "Pendleton" }), PROFILES).source).toBe("unmatched");
  });
});

describe("evaluateCity", () => {
  it("scores a town the same way a property is scored", () => {
    const results = evaluateCity(GREENFIELD, model);
    expect(results.map((r) => r.name)).toEqual(["Schools", "Location"]);
    expect(results[0].score).toBe(88);
    // 85 * 0.6 + 100 * 0.4
    expect(results[1].score).toBeCloseTo(91, 6);
  });

  it("leaves the building categories alone", () => {
    expect(evaluateCity(GREENFIELD, model).some((r) => r.name === "Living Spaces")).toBe(false);
  });
});

describe("a property inheriting its city", () => {
  const externals = (p: Property) => {
    const e = cityExternals(resolveCityProfile(p, PROFILES).profile, model);
    return { externalScores: e.categories, externalSubScores: e.subcriteria };
  };
  const evaluate = (p: Property, scores: any[] = [], subScores: any[] = []) =>
    evaluateProperty(
      { property: p, scores, subScores, ...externals(p) },
      { categories: CATEGORIES, subcriteria: SUBS }
    );

  it("takes the town's ratings without anything typed on the property", () => {
    const r = evaluate(prop(1));
    expect(r.categories.find((c) => c.name === "Schools")?.score).toBe(88);
    expect(r.categories.find((c) => c.name === "Location")?.score).toBeCloseTo(91, 6);
  });

  it("lets a hand-entered score on the property beat the town", () => {
    const r = evaluate(prop(1), [
      { property_id: 1, category_id: 1, score: null, mark_score: 60, rachel_score: 60, override_score: null, override_reason: null, notes: null },
    ]);
    const schools = r.categories.find((c) => c.name === "Schools")!;
    expect(schools.score).toBe(60);
    expect(schools.external_score).toBe(88);
  });

  it("lets a single subcriterion be corrected without losing the rest of the town", () => {
    const r = evaluate(prop(1), [], [
      { property_id: 1, subcriterion_id: 10, score: null, mark_score: 40, rachel_score: 40 },
    ]);
    const location = r.categories.find((c) => c.name === "Location")!;
    // 40 * 0.6 + the town's 100 * 0.4
    expect(location.score).toBeCloseTo(64, 6);
    expect(location.subcriteria.find((s) => s.subcriterion_id === 11)?.score).toBe(100);
  });

  it("borrows the other town's schools when told to", () => {
    const r = evaluate(prop(1, { city_profile_id: 2 }));
    expect(r.categories.find((c) => c.name === "Schools")?.score).toBe(60);
  });

  it("scores nothing from a city when the property is rated by hand", () => {
    const r = evaluate(prop(1, { city_ratings_manual: true }));
    expect(r.categories.find((c) => c.name === "Schools")?.score).toBeNull();
  });
});
