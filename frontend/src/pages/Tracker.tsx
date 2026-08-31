import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../lib/api";
import { fmtMoney, gradeClass } from "../lib/format";
import {
  availability, compareTracking, DECISIONS, isClosed, nextAction, stageCounts,
  stageOf, STAGES, todayISO, totalFees, type Stage,
} from "@shared/tracking/pipeline";
import { PROPERTY_STATUSES } from "@shared/types";
import type { Decision, PropertyResult, Tracking } from "@shared/types";

type Row = PropertyResult & { lead_photo: string | null };
type Draft = Record<string, string>;

const FIELDS = [
  "tour_on", "applied_on", "application_fee", "decision", "available_on",
  "lease_signed_on", "follow_up_on", "contact", "tracking_notes", "status",
] as const;

/** Grades the summary strip and the stage chips by how the stage feels, not its order. */
const STAGE_TONE: Record<Stage, string> = {
  "Not started": "", "Tour booked": "accent", Toured: "accent", Applied: "warn",
  Approved: "ok", Waitlisted: "warn", Denied: "fail", Withdrawn: "fail", Signed: "ok",
};

const SORTS = [
  { key: "urgency", label: "What needs you next" },
  { key: "available", label: "Available soonest" },
  { key: "score", label: "Score" },
] as const;

const str = (v: unknown) => (v == null ? "" : String(v));
const shortDate = (iso: string | null) => {
  if (!iso) return "—";
  const [, m, d] = iso.split("-");
  return m && d ? `${Number(m)}/${Number(d)}` : iso;
};

/**
 * The application tracker.
 *
 * The rest of the app answers "is this place any good?". This page answers the question
 * that actually loses you an apartment: what have we done about it, and what is about to
 * expire. Everything here is stored on the property itself, so a listing is never
 * entered twice — the tracker is a second view of the same places, not a second list.
 */
export default function Tracker() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<(typeof SORTS)[number]["key"]>("urgency");
  const [showClosed, setShowClosed] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  const today = todayISO();

  function reload() {
    return api.properties("overall").then(setRows).catch((e) => setError(String(e.message)));
  }

  useEffect(() => {
    reload();
  }, []);

  const sorted = useMemo(() => {
    if (!rows) return [];
    const visible = rows.filter(
      (r) => showClosed || !isClosed(stageOf(r.property, today))
    );
    const keyed = visible.map((r) => ({ row: r, name: r.property.name, tracking: r.property as Tracking }));
    if (sort === "urgency") {
      keyed.sort((a, b) => compareTracking(a, b, today));
    } else if (sort === "available") {
      keyed.sort((a, b) => {
        const av = a.tracking.available_on;
        const bv = b.tracking.available_on;
        if (av === bv) return a.name.localeCompare(b.name);
        if (!av) return 1;
        if (!bv) return -1;
        return av < bv ? -1 : 1;
      });
    } else {
      keyed.sort((a, b) => (b.row.overall ?? -1) - (a.row.overall ?? -1));
    }
    return keyed.map((k) => k.row);
  }, [rows, sort, showClosed, today]);

  if (error) return <div className="err">{error}</div>;
  if (!rows) return <div className="empty">Loading…</div>;

  const all = rows.map((r) => r.property as Tracking);
  const counts = stageCounts(all, today);
  const fees = totalFees(all);
  const hidden = rows.length - sorted.length;
  const chasing = sorted.filter((r) => nextAction(r.property, today).overdue).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tracker</h1>
          <div className="sub">
            Where each place stands — toured, applied, waiting on an answer, and when it
            frees up.
          </div>
        </div>
        <div className="spacer" />
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span className="tiny faint">Sort</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            style={{ width: "auto" }}
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty card card-pad">
          <h2>Nothing to track yet</h2>
          <p className="muted">
            Add a place on the Properties page and it appears here, ready to record the
            tour and the application.
          </p>
          <Link to="/add" className="btn primary" style={{ marginTop: 10 }}>
            + Add Property
          </Link>
        </div>
      ) : (
        <>
          <section className="track-summary card card-pad">
            {STAGES.filter((s) => counts[s] > 0).map((s) => (
              <div className="track-stat" key={s}>
                <div className="track-stat-n">{counts[s]}</div>
                <div className={`badge ${STAGE_TONE[s]}`}>{s}</div>
              </div>
            ))}
            {fees > 0 && (
              <div className="track-stat" style={{ marginLeft: "auto" }}>
                <div className="track-stat-n">{fmtMoney(fees)}</div>
                <div className="tiny faint">Application fees</div>
              </div>
            )}
          </section>

          {chasing > 0 && (
            <div className="note" style={{ marginBottom: 20 }}>
              {chasing === 1 ? "One place is" : `${chasing} places are`} past a follow-up
              date you set.
            </div>
          )}

          <div className="card">
            {/* The table scrolls inside the card, so a narrow phone never scrolls the page sideways. */}
            <div className="table-scroll">
            <table className="track-table">
              <thead>
                <tr>
                  <th>Place</th>
                  <th>Stage</th>
                  <th className="num">Toured</th>
                  <th className="num">Applied</th>
                  <th>Decision</th>
                  <th className="num">Available</th>
                  <th>Next</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <TrackRow
                    key={r.property.id}
                    row={r}
                    today={today}
                    open={open === r.property.id}
                    onToggle={() => setOpen((id) => (id === r.property.id ? null : r.property.id))}
                    onSaved={reload}
                  />
                ))}
              </tbody>
            </table>
            </div>
          </div>

          <div className="tiny faint" style={{ marginTop: 14, display: "flex", gap: 16 }}>
            <label className="checkline" style={{ margin: 0, textTransform: "none", letterSpacing: 0, fontSize: 12 }}>
              <input
                type="checkbox"
                checked={showClosed}
                onChange={(e) => setShowClosed(e.target.checked)}
              />
              Show finished ones
            </label>
            {hidden > 0 && !showClosed && <span>{hidden} hidden — signed, denied or withdrawn.</span>}
          </div>
        </>
      )}
    </>
  );
}

function TrackRow({
  row, today, open, onToggle, onSaved,
}: {
  row: Row;
  today: string;
  open: boolean;
  onToggle: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const p = row.property;
  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(Object.fromEntries(FIELDS.map((k) => [k, str(p[k])])));
    setError(null);
  }, [p, open]);

  const stage = stageOf(p, today);
  const action = nextAction(p, today);
  const free = availability(p, today);
  const set = (k: string) => (e: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, [k]: e.target.value }));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.updateProperty(p.id, draft);
      await onSaved();
      onToggle();
    } catch (e: any) {
      setError(String(e.message));
    } finally {
      setSaving(false);
    }
  }

  /** Stamp a date field with today — the tracker's most common single edit. */
  const stamp = (field: string) => setDraft((d) => ({ ...d, [field]: today }));

  return (
    <>
      <tr className={`track-row${open ? " open" : ""}`} onClick={onToggle}>
        <td>
          <div className="track-name">{p.name}</div>
          <div className="tiny faint">
            {[p.city, p.monthly_cost != null ? fmtMoney(p.monthly_cost) : null]
              .filter(Boolean)
              .join(" · ") || "No city"}
          </div>
          {/* Phone-only: the stage and availability columns fold in here rather than
              squeezing four columns into 375px. */}
          <div className="track-compact tiny">
            <span className={`badge ${STAGE_TONE[stage]}`}>{stage}</span>
            <span className={`avail-${free.state}`}>{free.label}</span>
          </div>
        </td>
        <td>
          <span className={`badge ${STAGE_TONE[stage]}`}>{stage}</span>
        </td>
        <td className="num">{shortDate(p.tour_on && p.tour_on <= today ? p.tour_on : null)}</td>
        <td className="num">{shortDate(p.applied_on)}</td>
        <td className={p.decision === "Pending" ? "faint" : ""}>{p.decision ?? "—"}</td>
        <td className={`num avail-${free.state}`}>{free.label}</td>
        <td className={action.overdue ? "overdue" : ""}>
          {action.label}
          {action.due && <span className="tiny faint"> · {shortDate(action.due)}</span>}
        </td>
        <td className="num">
          <span className={`grade-cell ${gradeClass(row.grade)}`}>{row.grade ?? "—"}</span>
        </td>
      </tr>

      {open && (
        <tr className="track-editor">
          <td colSpan={8}>
            <div className="row">
              <div className="field">
                <label>Tour</label>
                <input type="date" value={draft.tour_on ?? ""} onChange={set("tour_on")} />
                <button type="button" className="stamp" onClick={() => stamp("tour_on")}>Toured today</button>
              </div>
              <div className="field">
                <label>Applied</label>
                <input type="date" value={draft.applied_on ?? ""} onChange={set("applied_on")} />
                <button type="button" className="stamp" onClick={() => stamp("applied_on")}>Applied today</button>
              </div>
              <div className="field">
                <label>Application fee</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="0"
                  value={draft.application_fee ?? ""}
                  onChange={set("application_fee")}
                />
              </div>
              <div className="field">
                <label>Decision</label>
                <select value={draft.decision ?? ""} onChange={set("decision")}>
                  <option value="">Not applied</option>
                  {DECISIONS.map((d: Decision) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="row">
              <div className="field">
                <label>Date available</label>
                <input type="date" value={draft.available_on ?? ""} onChange={set("available_on")} />
              </div>
              <div className="field">
                <label>Follow up on</label>
                <input type="date" value={draft.follow_up_on ?? ""} onChange={set("follow_up_on")} />
              </div>
              <div className="field">
                <label>Lease signed</label>
                <input type="date" value={draft.lease_signed_on ?? ""} onChange={set("lease_signed_on")} />
              </div>
              <div className="field">
                <label>Status</label>
                <select value={draft.status ?? ""} onChange={set("status")}>
                  {PROPERTY_STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="row">
              <div className="field">
                <label>Contact</label>
                <input
                  placeholder="Leasing office, name and number"
                  value={draft.contact ?? ""}
                  onChange={set("contact")}
                />
              </div>
            </div>

            <div className="field">
              <label>Application notes</label>
              <textarea
                placeholder="What they asked for, what you sent, what they said."
                value={draft.tracking_notes ?? ""}
                onChange={set("tracking_notes")}
              />
            </div>

            {error && <div className="err" style={{ marginBottom: 14 }}>{error}</div>}

            <div className="dialog-actions" style={{ marginTop: 0 }}>
              <Link to={`/property/${p.id}`} className="btn sm ghost" style={{ marginRight: "auto" }}>
                Open property
              </Link>
              <button type="button" className="btn sm ghost" onClick={onToggle} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="btn sm primary" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
