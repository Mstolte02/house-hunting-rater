/**
 * Deal breakers: hard constraints that pull a property out of the rankings.
 *
 * A failing property is never deleted or hidden — it keeps its scores and stays
 * viewable. It is simply excluded from the ranked list, which is what you asked for:
 * "excluded from ranking, while still allowing us to view it."
 */

import type { CategoryResult, DealBreaker, Property } from "../types.js";

/** Property fields a deal breaker can be written against, plus derived keys. */
export function resolveField(
  field: string,
  property: Property,
  categories: CategoryResult[],
  overall: number | null
): number | null {
  if (field === "overall") return overall;

  const direct = (property as unknown as Record<string, unknown>)[field];
  if (typeof direct === "number") return direct;
  if (direct != null && direct !== "" && Number.isFinite(Number(direct))) {
    return Number(direct);
  }

  // Fall back to a category score by name, so "Commute" or "Condition" work as fields.
  const cat = categories.find(
    (c) => c.name.toLowerCase() === field.toLowerCase()
  );
  return cat?.score ?? null;
}

/**
 * Returns the labels of every enabled deal breaker this property violates.
 * A field with no value can't violate anything — we don't fail on missing data.
 */
export function applyDealBreakers(
  property: Property,
  categories: CategoryResult[],
  overall: number | null,
  dealBreakers: DealBreaker[]
): string[] {
  const failed: string[] = [];
  for (const db of dealBreakers) {
    if (!db.enabled) continue;
    const value = resolveField(db.field, property, categories, overall);
    if (value == null) continue;
    const violates =
      db.comparator === "max" ? value > db.value : value < db.value;
    if (violates) failed.push(db.label);
  }
  return failed;
}
