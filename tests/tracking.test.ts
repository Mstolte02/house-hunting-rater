import { describe, expect, it } from "vitest";

import {
  availability,
  compareTracking,
  daysBetween,
  isClosed,
  nextAction,
  stageCounts,
  stageOf,
  todayISO,
  totalFees,
} from "../shared/tracking/pipeline.js";
import type { Tracking } from "../shared/types.js";

const TODAY = "2026-08-31";

const track = (extra: Partial<Tracking> = {}): Tracking => ({
  tour_on: null, applied_on: null, application_fee: null, decision: null,
  available_on: null, lease_signed_on: null, follow_up_on: null, contact: null,
  tracking_notes: null, ...extra,
});

describe("stage", () => {
  it("starts at 'Not started' with nothing recorded", () => {
    expect(stageOf(track(), TODAY)).toBe("Not started");
  });

  it("tells a booked tour from one that already happened", () => {
    expect(stageOf(track({ tour_on: "2026-09-04" }), TODAY)).toBe("Tour booked");
    expect(stageOf(track({ tour_on: "2026-08-20" }), TODAY)).toBe("Toured");
  });

  it("counts a tour dated today as toured", () => {
    expect(stageOf(track({ tour_on: TODAY }), TODAY)).toBe("Toured");
  });

  it("moves to Applied once the application date is set", () => {
    expect(stageOf(track({ tour_on: "2026-08-20", applied_on: "2026-08-25" }), TODAY)).toBe("Applied");
  });

  it("keeps a pending decision at Applied", () => {
    expect(stageOf(track({ applied_on: "2026-08-25", decision: "Pending" }), TODAY)).toBe("Applied");
  });

  it("reports the decision once there is one", () => {
    expect(stageOf(track({ applied_on: "2026-08-25", decision: "Approved" }), TODAY)).toBe("Approved");
    expect(stageOf(track({ applied_on: "2026-08-25", decision: "Denied" }), TODAY)).toBe("Denied");
  });

  it("puts a signed lease above every other fact", () => {
    const signed = track({ applied_on: "2026-08-25", decision: "Approved", lease_signed_on: "2026-08-29" });
    expect(stageOf(signed, TODAY)).toBe("Signed");
  });

  it("marks signed, denied and withdrawn as closed and the rest as live", () => {
    expect(isClosed("Signed")).toBe(true);
    expect(isClosed("Denied")).toBe(true);
    expect(isClosed("Withdrawn")).toBe(true);
    expect(isClosed("Applied")).toBe(false);
    expect(isClosed("Waitlisted")).toBe(false);
  });
});

describe("next action", () => {
  it("names the step the stage implies", () => {
    expect(nextAction(track(), TODAY).label).toBe("Book a tour");
    expect(nextAction(track({ tour_on: "2026-08-20" }), TODAY).label).toBe("Apply");
    expect(nextAction(track({ applied_on: "2026-08-25" }), TODAY).label).toBe("Chase the decision");
    expect(nextAction(track({ applied_on: "2026-08-25", decision: "Approved" }), TODAY).label)
      .toBe("Sign the lease");
  });

  it("lets a follow-up date you set override the default step", () => {
    const action = nextAction(track({ applied_on: "2026-08-25", follow_up_on: "2026-09-02" }), TODAY);
    expect(action.label).toBe("Follow up");
    expect(action.due).toBe("2026-09-02");
    expect(action.overdue).toBe(false);
  });

  it("flags a follow-up date that has passed", () => {
    expect(nextAction(track({ applied_on: "2026-08-25", follow_up_on: "2026-08-28" }), TODAY).overdue)
      .toBe(true);
  });

  it("does not flag a follow-up due today", () => {
    expect(nextAction(track({ applied_on: "2026-08-25", follow_up_on: TODAY }), TODAY).overdue)
      .toBe(false);
  });

  it("asks nothing of a closed listing, even with a stale follow-up date", () => {
    const done = track({ applied_on: "2026-08-01", decision: "Denied", follow_up_on: "2026-08-10" });
    const action = nextAction(done, TODAY);
    expect(action.overdue).toBe(false);
    expect(action.label).toContain("Closed");
  });
});

describe("availability", () => {
  it("reports a date that has passed as already open", () => {
    const free = availability(track({ available_on: "2026-08-24" }), TODAY);
    expect(free.state).toBe("open");
    expect(free.days).toBe(-7);
  });

  it("calls the next month soon and anything further later", () => {
    expect(availability(track({ available_on: "2026-09-20" }), TODAY).state).toBe("soon");
    expect(availability(track({ available_on: "2026-11-01" }), TODAY).state).toBe("later");
  });

  it("says so when no date is listed", () => {
    expect(availability(track(), TODAY).state).toBe("unknown");
    expect(availability(track(), TODAY).days).toBe(null);
  });

  it("counts days across a daylight-saving change without drifting", () => {
    expect(daysBetween("2026-10-30", "2026-11-06")).toBe(7);
    expect(daysBetween("2026-03-06", "2026-03-13")).toBe(7);
  });

  it("ignores a date it cannot read", () => {
    expect(daysBetween("2026-08-31", "not a date")).toBe(null);
  });
});

describe("ordering", () => {
  const row = (name: string, t: Partial<Tracking> = {}) => ({ name, tracking: track(t) });

  it("puts an overdue follow-up first and a closed listing last", () => {
    const rows = [
      row("Signed place", { lease_signed_on: "2026-08-20" }),
      row("Untouched", {}),
      row("Overdue", { applied_on: "2026-08-10", follow_up_on: "2026-08-20" }),
      row("Approved", { applied_on: "2026-08-12", decision: "Approved" }),
    ];
    rows.sort((a, b) => compareTracking(a, b, TODAY));
    expect(rows.map((r) => r.name)).toEqual(["Overdue", "Approved", "Untouched", "Signed place"]);
  });

  it("breaks a tie on the soonest date, then the soonest availability", () => {
    const rows = [
      row("Later tour", { tour_on: "2026-09-10" }),
      row("Sooner tour", { tour_on: "2026-09-02" }),
    ];
    rows.sort((a, b) => compareTracking(a, b, TODAY));
    expect(rows[0].name).toBe("Sooner tour");

    const applied = [
      row("Frees in November", { applied_on: "2026-08-20", available_on: "2026-11-01" }),
      row("Frees in September", { applied_on: "2026-08-20", available_on: "2026-09-15" }),
    ];
    applied.sort((a, b) => compareTracking(a, b, TODAY));
    expect(applied[0].name).toBe("Frees in September");
  });

  it("is stable on name when nothing else separates two places", () => {
    const rows = [row("Birch St"), row("Ash Ave")].map((r) => r);
    rows.sort((a, b) => compareTracking(a, b, TODAY));
    expect(rows.map((r) => r.name)).toEqual(["Ash Ave", "Birch St"]);
  });
});

describe("summary", () => {
  it("counts every stage, including the empty ones", () => {
    const counts = stageCounts(
      [track(), track({ applied_on: "2026-08-20" }), track({ applied_on: "2026-08-21" })],
      TODAY
    );
    expect(counts.Applied).toBe(2);
    expect(counts["Not started"]).toBe(1);
    expect(counts.Signed).toBe(0);
  });

  it("totals the application fees and ignores blanks", () => {
    expect(totalFees([track({ application_fee: 50 }), track(), track({ application_fee: 75 })]))
      .toBe(125);
  });
});

describe("todayISO", () => {
  it("reads the local calendar date, not the UTC one", () => {
    // 9pm on 31 August in a US timezone is already 1 September in UTC. The tracker
    // compares against dates a person typed, so it has to stay on their calendar.
    const evening = new Date(2026, 7, 31, 21, 30);
    expect(todayISO(evening)).toBe("2026-08-31");
  });
});
