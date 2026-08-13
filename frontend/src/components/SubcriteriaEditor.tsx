import { useMemo, useState } from "react";

import { api, type CategoryWithSubs, type MetricInfo } from "../lib/api";

/**
 * Subcriteria for one category, weighted as percentages that should total 100 — the
 * same shape as the category weights above them, so the model reads consistently at
 * every level.
 *
 * The engine normalizes by whatever the enabled, scored subcriteria actually add up to,
 * so a total other than 100 still produces a correct score. The warning is there because
 * a total that drifts is almost always a mistake, not an intention.
 */
export default function SubcriteriaEditor({
  cat,
  metrics,
  onChanged,
}: {
  cat: CategoryWithSubs;
  metrics: MetricInfo[];
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [weight, setWeight] = useState("");
  const [busy, setBusy] = useState(false);

  const total = useMemo(
    () => cat.subcriteria.filter((s) => s.enabled).reduce((a, s) => a + s.weight, 0),
    [cat.subcriteria]
  );

  /** Suggest whatever is left of 100 so adding one more is a single keystroke. */
  const suggested = Math.max(0, Math.round((100 - total) * 10) / 10);

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.addSubcriterion(cat.id, {
        name: name.trim(),
        weight: Number(weight === "" ? suggested : weight) || 0,
      });
      setName("");
      setWeight("");
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function evenSplit() {
    const active = cat.subcriteria.filter((s) => s.enabled);
    if (active.length === 0) return;
    const each = Math.round((100 / active.length) * 10) / 10;
    for (const s of active) await api.updateSubcriterion(s.id, { weight: each });
    await onChanged();
  }

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <div className="section-title" style={{ marginBottom: 0 }}>Subcriteria</div>
        {cat.subcriteria.length > 0 && (
          <>
            <span
              className={Math.abs(total - 100) < 0.05 ? "badge ok" : "badge warn"}
              style={{ marginLeft: "auto" }}
            >
              {total.toFixed(1)}% of 100
            </span>
            <button className="btn sm ghost" onClick={evenSplit}>Even split</button>
          </>
        )}
      </div>

      {cat.subcriteria.length === 0 ? (
        <div className="tiny faint" style={{ margin: "12px 0" }}>
          None yet — {cat.name} is scored as one number. Add subcriteria to break it down.
        </div>
      ) : (
        <div style={{ margin: "14px 0" }}>
          {cat.subcriteria.map((s) => {
            const auto = metrics.find((m) => m.key === s.metric);
            return (
              <div
                className="sub-row"
                key={s.id}
                style={{ gridTemplateColumns: "1fr 96px auto auto" }}
              >
                <span>
                  <input
                    className="sub-name"
                    defaultValue={s.name}
                    style={{ border: "none", padding: 0, background: "none" }}
                    onBlur={async (e) => {
                      if (e.target.value.trim() && e.target.value !== s.name) {
                        await api.updateSubcriterion(s.id, { name: e.target.value.trim() });
                        await onChanged();
                      }
                    }}
                  />
                  {auto && (
                    <span className="badge accent" style={{ marginLeft: 8 }}>auto</span>
                  )}
                </span>
                <span className="weight-input" style={{ width: 96 }}>
                  <input
                    defaultValue={s.weight}
                    inputMode="decimal"
                    style={{ fontSize: 15 }}
                    onBlur={async (e) => {
                      const v = Number(e.target.value);
                      if (e.target.value.trim() === "" || !Number.isFinite(v) || v < 0) {
                        e.target.value = String(s.weight);
                        return;
                      }
                      if (v === s.weight) return;
                      await api.updateSubcriterion(s.id, { weight: v });
                      await onChanged();
                    }}
                  />
                  <span className="pct">%</span>
                </span>
                <label className="checkline tiny" style={{ marginBottom: 0 }}>
                  <input
                    type="checkbox"
                    checked={s.enabled}
                    onChange={async (e) => {
                      await api.updateSubcriterion(s.id, { enabled: e.target.checked });
                      await onChanged();
                    }}
                  />
                  on
                </label>
                <button
                  className="btn sm danger"
                  onClick={async () => {
                    if (!confirm(`Remove "${s.name}"?`)) return;
                    await api.deleteSubcriterion(s.id);
                    await onChanged();
                  }}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 96px auto", gap: 12 }}>
        <input
          value={name}
          placeholder="Layout, Kitchen, Storage…"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <span className="weight-input" style={{ width: 96 }}>
          <input
            value={weight}
            inputMode="decimal"
            placeholder={String(suggested)}
            style={{ fontSize: 15 }}
            onChange={(e) => setWeight(e.target.value)}
          />
          <span className="pct">%</span>
        </span>
        <button className="btn sm" onClick={add} disabled={busy || !name.trim()}>
          Add
        </button>
      </div>
    </div>
  );
}
