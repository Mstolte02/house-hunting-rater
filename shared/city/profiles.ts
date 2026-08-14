/**
 * City profiles: town-level ratings that properties inherit.
 *
 * Schools, safety and what's nearby are facts about a town, not about a house. Rating
 * them per property meant typing the same 88 into six Greenfield listings and then
 * having to remember all six when the opinion changed. These helpers rate the town once
 * and hand the result to the scoring engine as an ordinary external score — which means
 * the engine needs no new concepts, and the existing precedence rules already give a
 * hand-entered property score the last word.
 *
 * Pure functions over plain objects: no React, no storage, no fetch.
 */

import { calculateCategoryScore, DEFAULT_DISAGREEMENT_THRESHOLD } from "../scoring/category.js";
import { DEFAULT_GRADE_SCALE, type GradeBand } from "../scoring/grade.js";
import type {
  Category,
  CategoryResult,
  CityProfile,
  CityScore,
  CitySubScore,
  Property,
  PropertyScore,
  RaterCombine,
  Subcriterion,
} from "../types.js";

/** Category names that become city-scoped the first time an old snapshot is loaded. */
export const DEFAULT_CITY_SCOPED_CATEGORIES = ["Schools", "Safety", "Location"];

/** Loose town-name match: case, spacing and punctuation shouldn't decide a match. */
export function normalizeCityName(name: string | null | undefined): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function findCityProfileByName(
  profiles: CityProfile[],
  name: string | null | undefined
): CityProfile | null {
  const key = normalizeCityName(name);
  if (!key) return null;
  return profiles.find((p) => normalizeCityName(p.name) === key) ?? null;
}

export type CityLink =
  | { profile: CityProfile; source: "matched" | "borrowed" }
  | { profile: null; source: "manual" | "unmatched" };

/**
 * Which city's ratings this property uses.
 *
 * "matched"  — the profile whose name equals the property's city (the normal case).
 * "borrowed" — an explicitly chosen other town, for a property far enough out that its
 *              mailing address lies about which schools and shops it actually has.
 * "manual"   — city profiles switched off for this property; rate it by hand.
 * "unmatched"— a city with no profile yet.
 */
export function resolveCityProfile(
  property: Pick<Property, "city" | "city_profile_id" | "city_ratings_manual">,
  profiles: CityProfile[]
): CityLink {
  if (property.city_ratings_manual) return { profile: null, source: "manual" };
  if (property.city_profile_id != null) {
    const chosen = profiles.find((p) => p.id === property.city_profile_id);
    if (chosen) {
      const matched = normalizeCityName(chosen.name) === normalizeCityName(property.city);
      return { profile: chosen, source: matched ? "matched" : "borrowed" };
    }
  }
  const byName = findCityProfileByName(profiles, property.city);
  return byName ? { profile: byName, source: "matched" } : { profile: null, source: "unmatched" };
}

export interface CityModel {
  categories: Category[];
  subcriteria: Subcriterion[];
  cityScores: CityScore[];
  citySubScores: CitySubScore[];
  combine?: RaterCombine;
  gradeScale?: GradeBand[];
  disagreementThreshold?: number;
}

/**
 * Score one city on the city-scoped categories, using the very same category maths the
 * properties use — so a town's Location rolls up from its subcriteria exactly the way a
 * property's does, and the Cities page can show real grades.
 */
export function evaluateCity(profile: CityProfile, model: CityModel): CategoryResult[] {
  const {
    categories,
    subcriteria,
    cityScores,
    citySubScores,
    combine = "average",
    gradeScale = DEFAULT_GRADE_SCALE,
    disagreementThreshold = DEFAULT_DISAGREEMENT_THRESHOLD,
  } = model;

  const scoreByCat = new Map(
    cityScores.filter((s) => s.city_profile_id === profile.id).map((s) => [s.category_id, s])
  );
  const subScores = new Map(
    citySubScores
      .filter((s) => s.city_profile_id === profile.id)
      .map((s) => [
        s.subcriterion_id,
        {
          property_id: profile.id,
          subcriterion_id: s.subcriterion_id,
          score: s.score,
          mark_score: s.mark_score,
          rachel_score: s.rachel_score,
        },
      ])
  );

  return cityScopedCategories(categories).map((category) => {
    const stored = scoreByCat.get(category.id);
    const score: PropertyScore | undefined = stored && {
      property_id: profile.id,
      category_id: category.id,
      score: stored.score,
      mark_score: stored.mark_score,
      rachel_score: stored.rachel_score,
      override_score: null,
      override_reason: null,
      notes: stored.notes,
    };
    return calculateCategoryScore({
      category,
      score,
      subcriteria: subcriteria.filter((s) => s.category_id === category.id),
      subScores,
      combine,
      gradeScale,
      disagreementThreshold,
    });
  });
}

export function cityScopedCategories(categories: Category[]): Category[] {
  return categories.filter((c) => c.city_scoped);
}

export interface CityExternals {
  /** category id -> the city's score for it. */
  categories: Record<number, number | null>;
  /** subcriterion id -> the city's score for it. */
  subcriteria: Record<number, number | null>;
}

/**
 * The city's ratings in the shape the scoring engine already accepts.
 *
 * External scores sit at the bottom of the precedence ladder, so anything Mark or Rachel
 * types on the property itself automatically wins — that is the per-property override,
 * with no extra machinery.
 */
export function cityExternals(
  profile: CityProfile | null,
  model: CityModel
): CityExternals {
  const empty: CityExternals = { categories: {}, subcriteria: {} };
  if (!profile) return empty;
  for (const result of evaluateCity(profile, model)) {
    empty.categories[result.category_id] = result.score;
    for (const sub of result.subcriteria) empty.subcriteria[sub.subcriterion_id] = sub.score;
  }
  return empty;
}
