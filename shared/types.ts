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

export interface Property {
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
  notes: string | null;
  pros: string | null;
  cons: string | null;
  visit_notes: string | null;
  created_at: string;
  updated_at: string;
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
