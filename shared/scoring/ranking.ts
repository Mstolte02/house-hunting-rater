/**
 * Ranking. Properties that fail a deal breaker are excluded from the ranked set and
 * carry rank = null; everything else is ordered by the chosen key, best first.
 */

import type { PropertyResult } from "../types.js";

export type SortKey =
  | "overall"
  | "price"
  | "newest"
  | "favorite"
  | { category: string };

function keyValue(r: PropertyResult, sort: SortKey): number | null {
  if (typeof sort === "object") {
    return r.categories.find((c) => c.name === sort.category)?.score ?? null;
  }
  switch (sort) {
    case "overall":
      return r.overall;
    case "price":
      // Cheaper is better, so negate to keep "higher sorts first" uniform.
      return r.property.monthly_cost == null ? null : -r.property.monthly_cost;
    case "newest":
      return new Date(r.property.created_at).getTime() || null;
    case "favorite":
      return r.property.status === "Favorite" ? 1 : 0;
    default:
      return r.overall;
  }
}

/**
 * Assigns rank to the properties that pass their deal breakers, in place-independent
 * fashion, and returns a new array sorted for display (ranked first, then excluded).
 */
export function calculateRanking(
  results: PropertyResult[],
  sort: SortKey = "overall"
): PropertyResult[] {
  const eligible = results.filter((r) => r.failed_deal_breakers.length === 0);
  const excluded = results.filter((r) => r.failed_deal_breakers.length > 0);

  const ordered = [...eligible].sort((a, b) => {
    const av = keyValue(a, sort);
    const bv = keyValue(b, sort);
    if (av == null && bv == null) return a.property.name.localeCompare(b.property.name);
    if (av == null) return 1;
    if (bv == null) return -1;
    if (bv !== av) return bv - av;
    // Stable, meaningful tiebreak so equal scores don't shuffle between renders.
    return a.property.name.localeCompare(b.property.name);
  });

  ordered.forEach((r, i) => {
    r.rank = i + 1;
  });
  excluded.forEach((r) => {
    r.rank = null;
  });

  return [...ordered, ...excluded];
}
