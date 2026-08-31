/**
 * The rental pipeline: what has happened to a listing, and what to do about it next.
 *
 * The rest of the app scores whether a place is *good*. This module tracks whether it
 * is still *gettable* — a great apartment you toured and never applied to is worth
 * nothing, and one that came free three weeks ago is probably already leased.
 *
 * Every function here is pure and works on plain date strings, so the whole tracker can
 * be unit-tested without a UI or a clock.
 */

import type { Decision, Tracking } from "../types.js";

/**
 * Where a listing stands. Derived, never stored: the dates already say it.
 *
 * Storing a stage as well as the dates that imply it means two facts that can disagree —
 * a row marked "Applied" with no application date, and no way to tell which is wrong.
 * The dates are what you actually know, so the stage is read back out of them.
 */
export type Stage =
  | "Not started"
  | "Tour booked"
  | "Toured"
  | "Applied"
  | "Approved"
  | "Waitlisted"
  | "Denied"
  | "Withdrawn"
  | "Signed";

/** Display order for stage summaries: the pipeline from first contact to keys. */
export const STAGES: Stage[] = [
  "Not started", "Tour booked", "Toured", "Applied",
  "Approved", "Waitlisted", "Denied", "Withdrawn", "Signed",
];

/** The stages that are finished — nothing you do now changes them. */
export const CLOSED_STAGES: Stage[] = ["Denied", "Withdrawn", "Signed"];

export const DECISIONS: Decision[] = [
  "Pending", "Approved", "Waitlisted", "Denied", "Withdrawn",
];

/** Today as "YYYY-MM-DD" in the viewer's own timezone, not UTC. */
export function todayISO(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Whole days from `from` to `to`, both "YYYY-MM-DD".
 *
 * Parsed at UTC noon so a daylight-saving change can never turn 7 days into 6.9 and
 * round the wrong way.
 */
export function daysBetween(from: string, to: string): number | null {
  const a = parseISO(from);
  const b = parseISO(to);
  if (a == null || b == null) return null;
  return Math.round((b - a) / 86_400_000);
}

function parseISO(date: string | null): number | null {
  if (!date) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
}

export function stageOf(t: Tracking, today: string): Stage {
  if (t.lease_signed_on) return "Signed";
  if (t.decision && t.decision !== "Pending") return t.decision as Stage;
  if (t.applied_on) return "Applied";
  if (t.tour_on) return t.tour_on <= today ? "Toured" : "Tour booked";
  return "Not started";
}

export function isClosed(stage: Stage): boolean {
  return CLOSED_STAGES.includes(stage);
}

export interface NextAction {
  label: string;
  /** The date this is due, when it has one. */
  due: string | null;
  /** Past its due date and still not done. */
  overdue: boolean;
}

/**
 * The one thing to do next for this listing.
 *
 * A follow-up date you set yourself outranks the stage's default action: it's the only
 * field where you've said explicitly when you want to be back on this.
 */
export function nextAction(t: Tracking, today: string): NextAction {
  const stage = stageOf(t, today);
  if (stage === "Signed") return { label: "Done — lease signed", due: null, overdue: false };
  if (stage === "Denied") return { label: "Closed — denied", due: null, overdue: false };
  if (stage === "Withdrawn") return { label: "Closed — withdrawn", due: null, overdue: false };

  if (t.follow_up_on) {
    return { label: "Follow up", due: t.follow_up_on, overdue: t.follow_up_on < today };
  }
  switch (stage) {
    case "Tour booked":
      return { label: "Tour booked", due: t.tour_on, overdue: false };
    case "Toured":
      return { label: "Apply", due: null, overdue: false };
    case "Applied":
      return { label: "Chase the decision", due: null, overdue: false };
    case "Approved":
      return { label: "Sign the lease", due: null, overdue: false };
    case "Waitlisted":
      return { label: "Check the waitlist", due: null, overdue: false };
    default:
      return { label: "Book a tour", due: null, overdue: false };
  }
}

export type AvailabilityState = "unknown" | "open" | "soon" | "later";

export interface Availability {
  state: AvailabilityState;
  /** Days from today until the place is free. Negative once that date has passed. */
  days: number | null;
  label: string;
}

/** How soon you could move in. "soon" is within a month — inside a normal notice period. */
export function availability(t: Tracking, today: string): Availability {
  const days = t.available_on ? daysBetween(today, t.available_on) : null;
  if (days == null) return { state: "unknown", days: null, label: "Not listed" };
  if (days < 0) return { state: "open", days, label: `Open ${-days}d ago` };
  if (days === 0) return { state: "open", days, label: "Open today" };
  if (days <= 30) return { state: "soon", days, label: `In ${days}d` };
  return { state: "later", days, label: `In ${days}d` };
}

/**
 * Sort key, lowest first: what needs you soonest.
 *
 * Overdue follow-ups beat everything, closed listings sink, and in between the order
 * follows how much is at stake — an approval you have to sign matters more than a tour
 * you have not booked.
 */
export function urgencyRank(t: Tracking, today: string): number {
  const stage = stageOf(t, today);
  const action = nextAction(t, today);
  if (action.overdue) return 0;
  if (stage === "Approved") return 1;
  if (stage === "Tour booked") return 2;
  if (stage === "Applied") return 3;
  if (stage === "Toured") return 4;
  if (stage === "Waitlisted") return 5;
  if (stage === "Not started") return 6;
  return 7;
}

/**
 * Order two listings for the tracker table.
 *
 * Within one urgency band the tie-breaks run soonest-dated first: the follow-up or tour
 * you have a date for, then the place that frees up first, then the name so the order
 * never wobbles between renders.
 */
export function compareTracking(
  a: { name: string; tracking: Tracking },
  b: { name: string; tracking: Tracking },
  today: string
): number {
  const rank = urgencyRank(a.tracking, today) - urgencyRank(b.tracking, today);
  if (rank !== 0) return rank;

  const due = compareDates(nextAction(a.tracking, today).due, nextAction(b.tracking, today).due);
  if (due !== 0) return due;

  const free = compareDates(a.tracking.available_on, b.tracking.available_on);
  if (free !== 0) return free;

  return a.name.localeCompare(b.name);
}

/** Earliest date first. A missing date sorts last — it can't be the most pressing. */
function compareDates(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? -1 : 1;
}

/** How many listings sit at each stage, for the summary strip. */
export function stageCounts(rows: Tracking[], today: string): Record<Stage, number> {
  const counts = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
  for (const row of rows) counts[stageOf(row, today)] += 1;
  return counts;
}

/** Total spent on application fees — the part of a hunt that quietly adds up. */
export function totalFees(rows: Tracking[]): number {
  return rows.reduce((sum, r) => sum + (Number.isFinite(Number(r.application_fee)) ? Number(r.application_fee) || 0 : 0), 0);
}
