/**
 * Shared domain types for the housing rater.
 *
 * Everything the scoring engine touches lives here. The engine never imports React,
 * express, or the database — it takes plain objects and returns plain objects, so the
 * whole model can be unit-tested without a UI or a server.
 */

/**
 * How a category or subcriterion gets its number.
 *
 * "manual" means you type it. "external" means an automatic source fills it, named by
 * the row's `metric` key. There is deliberately no "formula" here: a scoring method you
 * can select but never configure is a dead option, so automatic scoring is expressed as
 * a concrete named source instead (see METRIC keys on the server).
 */
export type ScoringMethod = "manual" | "external";

/**
 * Identifier of an automatic score source, e.g. "similarity:westfield",
 * "commute:mark". Null means the row is scored by hand. The scoring engine never
 * interprets these — the server resolves them to numbers and hands them in.
 */
export type MetricKey = string | null;

export type PropertyType = "House" | "Apartment" | "Condo" | "Townhome" | "Other";

export type PropertyStatus =
  | "Considering"
  | "Favorite"
  | "Scheduled"
  | "Visited"
  | "Rejected"
  | "Leased/Purchased";

/** How two people's independent scores collapse into one category score. */
export type RaterCombine = "average" | "min" | "max";

/** What the landlord said once you applied. "Pending" means they have not answered yet. */
export type Decision = "Pending" | "Approved" | "Waitlisted" | "Denied" | "Withdrawn";

/**
 * The application side of a listing: what you have done about it, and by when.
 *
 * Kept apart from `status` deliberately. `status` is what you think of a place —
 * favorite, rejected. This is what has actually happened to it: toured, applied,
 * answered. A place can be your favorite and still be one you never applied to, and
 * that gap is the thing this exists to catch.
 *
 * Dates are plain "YYYY-MM-DD" strings, so they compare correctly as text and never
 * shift a day across timezones.
 */
export interface Tracking {
  /** The tour date. A future date is booked; a past date happened. */
  tour_on: string | null;
  applied_on: string | null;
  /** What the application cost, whatever came of it. */
  application_fee: number | null;
  /** Null until you apply. */
  decision: Decision | null;
  /** The date the unit is free — the one that decides whether any of this is in time. */
  available_on: string | null;
  lease_signed_on: string | null;
  /** When to chase this again. This drives the tracker's "needs you now" order. */
  follow_up_on: string | null;
  /** Leasing agent, landlord, whoever answers the phone. */
  contact: string | null;
  /** Notes about the application, kept apart from notes about the building. */
  tracking_notes: string | null;
}

export interface Category {
  id: number;
  name: string;
  description: string | null;
  weight: number;
  enabled: boolean;
  scoring_method: ScoringMethod;
  metric: MetricKey;
  /**
   * True when Mark and Rachel rate this together instead of separately — one agreed
   * number, no averaging and no disagreement gap. Applies to the category's
   * subcriteria too.
   */
  single_score: boolean;
  /**
   * True when this category describes the town rather than the building — schools,
   * safety, what's nearby. Those are rated once per city on the Cities page and every
   * property in that city inherits the rating, instead of being retyped house by house.
   * A property can still overrule its city (see `city_profile_id` / `city_ratings_manual`).
   */
  city_scoped: boolean;
  sort_order: number;
}

export interface Subcriterion {
  id: number;
  category_id: number;
  name: string;
  weight: number;
  enabled: boolean;
  metric: MetricKey;
}

/** A raw 0-100 rating. Either a single agreed score, or Mark's and Rachel's separately. */
export interface RatedScore {
  score: number | null;
  mark_score: number | null;
  rachel_score: number | null;
}

export interface PropertyScore extends RatedScore {
  property_id: number;
  category_id: number;
  /** Set when the user deliberately replaces the computed value. */
  override_score: number | null;
  override_reason: string | null;
  notes: string | null;
}

export interface SubcriterionScore extends RatedScore {
  property_id: number;
  subcriterion_id: number;
}

export interface Property extends Tracking {
  id: number;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  url: string | null;
  property_type: PropertyType;
  status: PropertyStatus;
  monthly_cost: number | null;
  hoa: number | null;
  property_taxes: number | null;
  insurance: number | null;
  utilities: number | null;
  deposit: number | null;
  move_in_costs: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  square_feet: number | null;
  lot_size: number | null;
  year_built: number | null;
  garage_spaces: number | null;
  parking: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Town name matched into the Indiana Similarity dataset. */
  similarity_town: string | null;
  /**
   * Which city profile supplies this property's city-scoped ratings. Null means "the
   * one that matches `city`" — set it only to borrow another town's ratings, e.g. a
   * house with a Greenfield address that is really out by the Fortville schools.
   */
  city_profile_id: number | null;
  /** True when this property ignores city profiles entirely and is rated by hand. */
  city_ratings_manual: boolean;
  notes: string | null;
  pros: string | null;
  cons: string | null;
  visit_notes: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * A town rated once, reused by every property in it.
 *
 * Schools, safety and what's nearby barely move between two houses on opposite sides of
 * the same town, so rating them per property was six copies of the same number. The
 * profile holds them once; properties read them and may overrule them.
 */
export interface CityProfile {
  id: number;
  name: string;
  state: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CityScore extends RatedScore {
  city_profile_id: number;
  category_id: number;
  notes: string | null;
}

export interface CitySubScore extends RatedScore {
  city_profile_id: number;
  subcriterion_id: number;
}

export interface DealBreaker {
  id: number;
  /** Property field or the literal "overall" / a category name. */
  field: string;
  comparator: "min" | "max";
  value: number;
  enabled: boolean;
  label: string;
}

/** The per-category result the UI renders and the overall score is built from. */
export interface CategoryResult {
  category_id: number;
  name: string;
  weight: number;
  enabled: boolean;
  /** 0-100, after subcriteria/rater combination and any override. */
  score: number | null;
  grade: string | null;
  /** What the model computed before an override replaced it. */
  computed_score: number | null;
  /**
   * The automatic value on its own, before any manual entry took precedence. Exposed so
   * the UI can recompute this category live while you type without re-asking the server.
   */
  external_score: number | null;
  /** Mirrors the category's setting so the UI knows to show one box, not two. */
  single_score: boolean;
  overridden: boolean;
  override_reason: string | null;
  mark_score: number | null;
  rachel_score: number | null;
  /** |mark - rachel|, null unless both are present. */
  agreement: number | null;
  disagreement_flag: boolean;
  subcriteria: SubcriterionResult[];
}

export interface SubcriterionResult {
  subcriterion_id: number;
  name: string;
  weight: number;
  score: number | null;
  grade: string | null;
  mark_score: number | null;
  rachel_score: number | null;
  agreement: number | null;
  /** Set when this subcriterion is filled by an automatic source. */
  metric: MetricKey;
  /** What the automatic source produced, before any manual entry took precedence. */
  computed_score: number | null;
}

/** One line of the "why is this an A-?" breakdown. */
export interface ContributionLine {
  name: string;
  score: number;
  weight: number;
  /** weight normalized across enabled+scored categories, 0-1. */
  normalized_weight: number;
  contribution: number;
}

export interface PropertyResult {
  property: Property;
  categories: CategoryResult[];
  overall: number | null;
  grade: string | null;
  contributions: ContributionLine[];
  /** Total weight of the categories that actually counted. */
  effective_weight: number;
  failed_deal_breakers: string[];
  rank: number | null;
}
