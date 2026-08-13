import { useEffect, useMemo, useState } from "react";

import { api, type CategoryWithSubs, type MetricInfo } from "../lib/api";
import { fmtScore, gradeClass } from "../lib/format";
import SimilarityPanel from "../components/SimilarityPanel";
import SubcriteriaEditor from "../components/SubcriteriaEditor";
import PresetsPanel from "../components/PresetsPanel";
import CommutePanel from "../components/CommutePanel";
import { calculateOverallScore } from "@shared/scoring/overall";
import { calculateRanking } from "@shared/scoring/ranking";
import { applyDealBreakers } from "@shared/scoring/dealbreakers";
import type { DealBreaker, PropertyResult } from "@shared/types";

/**
 * Automatic score sources still exist and still drive Westfield Similarity and the two
 * commutes — they're just no longer pickable from the UI, so a category can't be
 * silently repointed. Metrics are shown read-only where they apply.
 */

export default function Tuning() {
  const [cats, setCats] = useState<CategoryWithSubs[] | null>(null);
  const [baseline, setBaseline] = useState<PropertyResult[]>([]);
  const [dealBreakers, setDealBreakers] = useState<DealBreaker[]>([]);
  const [weights, setWeights] = useState<Record<number, number>>({});
  const [enabled, setEnabled] = useState<Record<number, boolean>>({});
  const [metrics, setMetrics] = useState<MetricInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function refresh() {
    const [c, p, d, m] = await Promise.all([
      api.categories(), api.properties(), api.dealBreakers(), api.metrics(),
    ]);
    setCats(c);
    setBaseline(p);
    setDealBreakers(d);
    setMetrics(m);
    setWeights(Object.fromEntries(c.map((x) => [x.id, x.weight])));
    setEnabled(Object.fromEntries(c.map((x) => [x.id, x.enabled])));
  }

  useEffect(() => {
    refresh().catch((e) => setError(String(e.message)));
  }, []);

  /**
   * Live preview. Re-runs the same scoring engine the server uses, in the browser,
   * against the already-fetched category scores — so dragging a weight re-ranks
   * instantly with no round trip.
   */
  const preview = useMemo(() => {
    if (!cats || baseline.length === 0) return [];
    const recomputed: PropertyResult[] = baseline.map((r) => {
      const categories = r.categories.map((c) => ({
        ...c,
        weight: weights[c.category_id] ?? c.weight,
        enabled: enabled[c.category_id] ?? c.enabled,
      }));
      const { overall, grade, contributions, effective_weight } =
        calculateOverallScore(categories);
      return {
        ...r,
        categories,
        overall,
        grade,
        contributions,
        effective_weight,
        failed_deal_breakers: applyDealBreakers(r.property, categories, overall, dealBreakers),
        rank: null,
      };
    });
    return calculateRanking(recomputed);
  }, [cats, baseline, weights, enabled, dealBreakers]);

  const total = useMemo(
    () =>
      (cats ?? [])
        .filter((c) => enabled[c.id])
        .reduce((a, c) => a + (weights[c.id] ?? 0), 0),
    [cats, weights, enabled]
  );

  const dirty = useMemo(
    () =>
      (cats ?? []).some(
        (c) => weights[c.id] !== c.weight || enabled[c.id] !== c.enabled
      ),
    [cats, weights, enabled]
  );

  async function saveWeights() {
    if (!cats) return;
    await api.saveWeights(cats.map((c) => ({ category_id: c.id, weight: weights[c.id] })));
    for (const c of cats) {
      if (enabled[c.id] !== c.enabled) {
        await api.updateCategory(c.id, { enabled: enabled[c.id] });
      }
    }
    await refresh();
  }

  if (error) return <div className="err">{error}</div>;
  if (!cats) return <div className="empty">Loading…</div>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tuning</h1>
          <div className="sub">Change the model and watch the rankings move.</div>
        </div>
        <div className="spacer" />
        <span className={total === 100 ? "badge ok" : "badge warn"}>
          Total weight {total.toFixed(1)}%
        </span>
        <button className="btn primary" onClick={saveWeights} disabled={!dirty}>
          {dirty ? "Save model" : "Saved"}
        </button>
      </div>

      <div className="tune-grid">
        <div className="stack">
          <section className="card plain">
            <div className="card-pad" style={{ paddingBottom: 6, display: "flex", alignItems: "center" }}>
              <div>
                <div className="section-title" style={{ marginBottom: 2 }}>Categories</div>
                <div className="tiny faint">
                  Add, rename, re-weight or remove — nothing here is hard-coded.
                </div>
              </div>
              <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => setAdding(true)}>
                + Add Category
              </button>
            </div>

            {adding && (
              <AddCategory
                onCancel={() => setAdding(false)}
                onSaved={async () => { setAdding(false); await refresh(); }}
              />
            )}

            {cats.map((c) => (
              <CategoryCard
                key={c.id}
                cat={c}
                metrics={metrics}
                weight={weights[c.id] ?? 0}
                enabled={enabled[c.id] ?? true}
                onWeight={(w) => setWeights((s) => ({ ...s, [c.id]: w }))}
                onEnabled={(v) => setEnabled((s) => ({ ...s, [c.id]: v }))}
                onChanged={refresh}
              />
            ))}
          </section>

          <GradeScaleCard />
          <DealBreakerCard
            dealBreakers={dealBreakers}
            categories={cats}
            onChanged={refresh}
          />
          <ExportCard />
        </div>

        <div className="stack sticky">
          <section className="card card-pad">
            <div className="section-title">
              {dirty ? "Updated model" : "Current model"}
            </div>
            {preview.length === 0 ? (
              <div className="tiny faint">Add properties to see rankings here.</div>
            ) : (
              preview.map((r) => {
                const before = baseline.find((b) => b.property.id === r.property.id);
                const delta =
                  before?.overall != null && r.overall != null
                    ? r.overall - before.overall
                    : 0;
                const moved = before?.rank != null && r.rank != null ? before.rank - r.rank : 0;
                return (
                  <div className="preview-row" key={r.property.id}>
                    <span className="pos">{r.rank ?? "—"}</span>
                    <span>
                      {r.property.name}
                      {moved !== 0 && (
                        <span className={`tiny ${moved > 0 ? "delta up" : "delta down"}`}>
                          {" "}{moved > 0 ? `▲${moved}` : `▼${-moved}`}
                        </span>
                      )}
                    </span>
                    <span className="mono tiny">
                      {fmtScore(r.overall)}
                      {delta !== 0 && (
                        <span className={`delta ${delta > 0 ? "up" : "down"}`}>
                          {" "}{delta > 0 ? "+" : ""}{delta.toFixed(1)}
                        </span>
                      )}
                    </span>
                    <span className={gradeClass(r.grade)} style={{ fontWeight: 640, minWidth: 26, textAlign: "right" }}>
                      {r.grade ?? "—"}
                    </span>
                  </div>
                );
              })
            )}
          </section>

          <PresetsPanel
            categories={cats}
            weights={weights}
            onLoad={(w) => setWeights(w)}
          />

          <CommutePanel />
          <SimilarityPanel />
        </div>
      </div>
    </>
  );
}

function CategoryCard({
  cat, metrics, weight, enabled, onWeight, onEnabled, onChanged,
}: {
  cat: CategoryWithSubs;
  metrics: MetricInfo[];
  weight: number;
  enabled: boolean;
  onWeight: (w: number) => void;
  onEnabled: (v: boolean) => void;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(cat.name);
  const [description, setDescription] = useState(cat.description ?? "");

  const metricLabel = metrics.find((m) => m.key === cat.metric)?.label;
  const hasSubs = cat.subcriteria.length > 0;

  async function save() {
    await api.updateCategory(cat.id, { name, description });
    setEditing(false);
    await onChanged();
  }

  async function remove() {
    if (!confirm(`Delete "${cat.name}"? Its scores on every property go with it.`)) return;
    await api.deleteCategory(cat.id);
    await onChanged();
  }

  return (
    <div className="cat-card">
      <div className="cat-top">
        <input
          type="checkbox" checked={enabled} style={{ width: "auto" }}
          onChange={(e) => onEnabled(e.target.checked)}
        />
        <div style={{ minWidth: 0 }}>
          <div className="cat-name">{cat.name}</div>
          <div className="cat-desc">
            {cat.description || "No description"}
            {metricLabel && (
              <span className="badge accent" style={{ marginLeft: 8 }}>
                auto · {metricLabel}
              </span>
            )}
            {hasSubs && (
              <span className="badge" style={{ marginLeft: 8 }}>
                {cat.subcriteria.length} subcriteria
              </span>
            )}
          </div>
        </div>
        <div className="cat-weight">
          <span className="weight-input">
            <input
              value={weight}
              inputMode="decimal"
              disabled={!enabled}
              aria-label={`${cat.name} weight`}
              onChange={(e) => {
                const v = e.target.value;
                // Allow the box to be emptied mid-edit without snapping to 0.
                if (v === "") return onWeight(0);
                const n = Number(v);
                if (Number.isFinite(n) && n >= 0) onWeight(n);
              }}
            />
            <span className="pct">%</span>
          </span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "center", marginTop: 14 }}>
        <button className="btn sm ghost" onClick={() => setEditing((v) => !v)}>
          {editing ? "Done" : "Edit"}
        </button>
        <button className="btn sm danger" onClick={remove}>Delete</button>
      </div>

      {editing && (
        <div style={{ marginTop: 12, background: "var(--panel-2)", padding: 12, borderRadius: 8 }}>
          <div className="row">
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Description</label>
              <input value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
          <div className="tiny muted" style={{ margin: "12px 0" }}>
            {metricLabel
              ? `Scored automatically from ${metricLabel}.`
              : hasSubs
              ? "Scored from this category's subcriteria below."
              : "You'll type a 0–100 score for this on each property."}
          </div>
          <button className="btn sm primary" onClick={save}>Save category</button>

          <SubcriteriaEditor cat={cat} metrics={metrics} onChanged={onChanged} />
        </div>
      )}
    </div>
  );
}

function ExportCard() {
  return (
    <section className="card plain card-pad">
      <div className="section-title">Export</div>
      <div className="tiny muted" style={{ marginBottom: 12 }}>
        The published database snapshot is built into the app. Changes made on this
        device stay in this browser. Use these exports for a portable backup.
      </div>
      <div className="pill-row">
        <button className="btn sm" onClick={() => api.exportProperties()}>
          ⬇ Properties CSV
        </button>
        <button className="btn sm" onClick={() => api.exportModel()}>
          ⬇ Model JSON
        </button>
      </div>
    </section>
  );
}

function AddCategory({
  onCancel, onSaved,
}: {
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [weight, setWeight] = useState("10");
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    try {
      await api.createCategory({ name, description, weight: Number(weight) });
      await onSaved();
    } catch (e: any) {
      setErr(String(e.message));
    }
  }

  return (
    <div className="cat-card" style={{ background: "var(--panel-2)" }}>
      {err && <div className="err" style={{ marginBottom: 10 }}>{err}</div>}
      <div className="row">
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Weight %</label>
          <input value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="decimal" />
        </div>
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <label>Description</label>
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn sm primary" onClick={save} disabled={!name.trim()}>Add</button>
        <button className="btn sm ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function GradeScaleCard() {
  const [scale, setScale] = useState<{ grade: string; min: number }[] | null>(null);
  const [combine, setCombine] = useState("average");
  const [threshold, setThreshold] = useState(15);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    api.settings().then((s) => {
      setScale(s.gradeScale);
      setCombine(s.raterCombine);
      setThreshold(s.disagreementThreshold);
    });
  }, []);

  if (!scale) return null;

  async function save() {
    await api.saveSettings({ gradeScale: scale, raterCombine: combine, disagreementThreshold: threshold });
    setDirty(false);
  }

  return (
    <section className="card plain card-pad">
      <div style={{ display: "flex", alignItems: "center" }}>
        <div className="section-title" style={{ marginBottom: 0 }}>Grading scale</div>
        <button className="btn sm primary" style={{ marginLeft: "auto" }} onClick={save} disabled={!dirty}>
          {dirty ? "Save" : "Saved"}
        </button>
      </div>

      <div className="row" style={{ margin: "14px 0" }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Mark + Rachel combine as</label>
          <select value={combine} onChange={(e) => { setCombine(e.target.value); setDirty(true); }}>
            <option value="average">Average</option>
            <option value="min">Minimum (deal-breaker style)</option>
            <option value="max">Maximum (enthusiasm style)</option>
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Flag disagreement at</label>
          <input
            value={threshold} inputMode="numeric"
            onChange={(e) => { setThreshold(Number(e.target.value) || 0); setDirty(true); }}
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 8 }}>
        {scale.map((b, i) => (
          <div key={b.grade} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className={gradeClass(b.grade)} style={{ fontWeight: 640, width: 22 }}>{b.grade}</span>
            <input
              value={b.min} inputMode="decimal"
              onChange={(e) => {
                const v = Number(e.target.value);
                setScale((s) => s!.map((x, j) => (j === i ? { ...x, min: Number.isFinite(v) ? v : 0 } : x)));
                setDirty(true);
              }}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

/** Property fields a rule can be written against, plus the derived "overall". */
const DB_FIELDS = [
  { value: "monthly_cost", label: "Monthly cost" },
  { value: "bedrooms", label: "Bedrooms" },
  { value: "bathrooms", label: "Bathrooms" },
  { value: "square_feet", label: "Square feet" },
  { value: "lot_size", label: "Lot size" },
  { value: "year_built", label: "Year built" },
  { value: "garage_spaces", label: "Garage spaces" },
  { value: "utilities", label: "Utilities" },
  { value: "deposit", label: "Deposit" },
  { value: "overall", label: "Overall score" },
];

function DealBreakerCard({
  dealBreakers, categories, onChanged,
}: {
  dealBreakers: DealBreaker[];
  categories: CategoryWithSubs[];
  onChanged: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  // A rule can also target any category by name, so they're offered alongside the
  // property fields.
  const fields = [
    ...DB_FIELDS,
    ...categories.map((c) => ({ value: c.name, label: `${c.name} (category)` })),
  ];

  return (
    <section className="card plain card-pad">
      <div style={{ display: "flex", alignItems: "center" }}>
        <div className="section-title" style={{ marginBottom: 0 }}>Deal breakers</div>
        <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => setAdding((v) => !v)}>
          {adding ? "Cancel" : "+ Add"}
        </button>
      </div>
      <div className="tiny muted" style={{ margin: "10px 0 12px" }}>
        A property that violates an enabled rule drops out of the rankings but stays
        viewable.
      </div>

      {adding && (
        <AddDealBreaker
          fields={fields}
          onCancel={() => setAdding(false)}
          onSaved={async () => { setAdding(false); await onChanged(); }}
        />
      )}
      {dealBreakers.map((d) => (
        <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid var(--line-soft)" }}>
          <input
            type="checkbox" checked={d.enabled} style={{ width: "auto" }}
            onChange={async (e) => {
              await api.updateDealBreaker(d.id, { enabled: e.target.checked });
              await onChanged();
            }}
          />
          <span style={{ flex: 1 }}>{d.label}</span>
          <span className="tiny faint mono">
            {d.field} {d.comparator === "max" ? "≤" : "≥"}
          </span>
          <input
            defaultValue={d.value} inputMode="decimal" style={{ width: 84 }}
            onBlur={async (e) => {
              const v = Number(e.target.value);
              // An empty or junk box means "no change" — never silently reset the
              // threshold to 0, which on a max rule would fail every property.
              if (e.target.value.trim() === "" || !Number.isFinite(v)) {
                e.target.value = String(d.value);
                return;
              }
              if (v === d.value) return;
              await api.updateDealBreaker(d.id, { value: v });
              await onChanged();
            }}
          />
          <button
            className="btn sm danger"
            title="Remove rule"
            onClick={async () => {
              if (!confirm(`Remove the "${d.label}" deal breaker?`)) return;
              await api.deleteDealBreaker(d.id);
              await onChanged();
            }}
          >
            ✕
          </button>
        </div>
      ))}
      {dealBreakers.length === 0 && (
        <div className="tiny muted">No rules yet.</div>
      )}
    </section>
  );
}

function AddDealBreaker({
  fields, onCancel, onSaved,
}: {
  fields: { value: string; label: string }[];
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [field, setField] = useState("monthly_cost");
  const [comparator, setComparator] = useState<"max" | "min">("max");
  const [value, setValue] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const valid = label.trim() !== "" && value.trim() !== "" && Number.isFinite(Number(value));

  async function save() {
    try {
      await api.createDealBreaker({
        label: label.trim(), field, comparator, value: Number(value), enabled: true,
      });
      await onSaved();
    } catch (e: any) {
      setErr(String(e.message));
    }
  }

  return (
    <div style={{ background: "var(--elevated)", padding: 14, borderRadius: 9, marginBottom: 14 }}>
      {err && <div className="err" style={{ marginBottom: 10 }}>{err}</div>}
      <div className="field">
        <label>What to call it</label>
        <input
          value={label} autoFocus placeholder="Monthly cost over budget"
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Field</label>
          <select value={field} onChange={(e) => setField(e.target.value)}>
            {fields.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Fails when</label>
          <select value={comparator} onChange={(e) => setComparator(e.target.value as "max" | "min")}>
            <option value="max">above</option>
            <option value="min">below</option>
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Value</label>
          <input value={value} inputMode="decimal" onChange={(e) => setValue(e.target.value)} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn sm primary" onClick={save} disabled={!valid}>Add rule</button>
        <button className="btn sm ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
