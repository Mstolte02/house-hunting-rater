import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { api, type CityRow } from "../lib/api";
import { fmtScore, gradeClass } from "../lib/format";
import { ScoreGrade } from "../components/GradeBadge";
import { calculateCategoryScore } from "@shared/scoring/category";
import { DEFAULT_GRADE_SCALE, type GradeBand } from "@shared/scoring/grade";
import type { CategoryResult, RaterCombine } from "@shared/types";

type Draft = { mark_score: string; rachel_score: string };
type Settings = { gradeScale: GradeBand[]; raterCombine: RaterCombine; disagreementThreshold: number };

const str = (v: number | null) => (v == null ? "" : String(v));
const num = (v: string | undefined) =>
  v == null || v.trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v);

/**
 * Towns, rated once.
 *
 * Schools, safety and what's nearby are the same for every house in a town, so they're
 * entered here and inherited by each property instead of being retyped listing by
 * listing. A property that sits far enough out can still borrow another town's ratings
 * or be rated by hand — that's set on the property itself.
 */
export default function Cities() {
  const [cities, setCities] = useState<CityRow[] | null>(null);
  const [settings, setSettings] = useState<Settings>({
    gradeScale: DEFAULT_GRADE_SCALE, raterCombine: "average", disagreementThreshold: 15,
  });
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newCity, setNewCity] = useState("");

  async function refresh() {
    setCities(await api.cities());
  }

  useEffect(() => {
    refresh().catch((e) => setError(String(e.message)));
    api.settings()
      .then((s) => setSettings({
        gradeScale: s.gradeScale, raterCombine: s.raterCombine, disagreementThreshold: s.disagreementThreshold,
      }))
      .catch(() => {});
  }, []);

  async function addCity() {
    try {
      await api.createCity({ name: newCity });
      setNewCity("");
      setAdding(false);
      await refresh();
    } catch (e: any) { setError(String(e.message)); }
  }

  if (error) return <div className="err">{error}</div>;
  if (!cities) return <div className="empty">Loading…</div>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Cities &amp; Towns</h1>
          <div className="sub">
            Rate a town once. Every property in it inherits these scores.
          </div>
        </div>
        <div className="spacer" />
        <button className="btn primary" onClick={() => setAdding((v) => !v)}>
          {adding ? "Cancel" : "+ Add City"}
        </button>
      </div>

      {adding && (
        <section className="card card-pad" style={{ marginBottom: 16 }}>
          <div className="row" style={{ gridTemplateColumns: "1fr auto", alignItems: "end" }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>City or town</label>
              <input
                value={newCity}
                autoFocus
                placeholder="Fortville"
                onChange={(e) => setNewCity(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addCity(); }}
              />
            </div>
            <button className="btn primary" onClick={addCity} disabled={!newCity.trim()}>
              Add
            </button>
          </div>
          <div className="tiny faint" style={{ marginTop: 8 }}>
            Typing a new city on a property adds it here automatically — this is for
            rating a town before you've found anything in it.
          </div>
        </section>
      )}

      {cities.length === 0 ? (
        <div className="empty">
          No towns yet. Add a property with a city, or add one above.
        </div>
      ) : (
        <div className="stack">
          {cities.map((row) => (
            <CityCard key={row.profile.id} row={row} settings={settings} onChanged={refresh} />
          ))}
        </div>
      )}
    </>
  );
}

function CityCard({
  row, settings, onChanged,
}: {
  row: CityRow;
  settings: Settings;
  onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(row.profile.name);
  const [renaming, setRenaming] = useState(false);
  const [cats, setCats] = useState<Record<number, Draft>>({});
  const [subs, setSubs] = useState<Record<number, Draft>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const c: Record<number, Draft> = {};
    const s: Record<number, Draft> = {};
    for (const cat of row.categories) {
      c[cat.category_id] = { mark_score: str(cat.mark_score), rachel_score: str(cat.rachel_score) };
      for (const sub of cat.subcriteria) {
        s[sub.subcriterion_id] = { mark_score: str(sub.mark_score), rachel_score: str(sub.rachel_score) };
      }
    }
    setCats(c);
    setSubs(s);
    setName(row.profile.name);
  }, [row]);

  /** The same category maths the properties use, so the grades move as you type. */
  const live = useMemo<CategoryResult[]>(() =>
    row.categories.map((cat) => calculateCategoryScore({
      category: {
        id: cat.category_id, name: cat.name, description: null, weight: cat.weight,
        enabled: cat.enabled, scoring_method: "manual", metric: null,
        single_score: cat.single_score, city_scoped: true, sort_order: 0,
      },
      score: {
        property_id: row.profile.id, category_id: cat.category_id, score: null,
        mark_score: num(cats[cat.category_id]?.mark_score),
        rachel_score: num(cats[cat.category_id]?.rachel_score),
        override_score: null, override_reason: null, notes: null,
      },
      subcriteria: cat.subcriteria.map((s) => ({
        id: s.subcriterion_id, category_id: cat.category_id, name: s.name,
        weight: s.weight, enabled: true, metric: s.metric,
      })),
      subScores: new Map(cat.subcriteria.map((s) => [s.subcriterion_id, {
        property_id: row.profile.id, subcriterion_id: s.subcriterion_id, score: null,
        mark_score: num(subs[s.subcriterion_id]?.mark_score),
        rachel_score: num(subs[s.subcriterion_id]?.rachel_score),
      }])),
      combine: settings.raterCombine,
      gradeScale: settings.gradeScale,
      disagreementThreshold: settings.disagreementThreshold,
    })),
  [row, cats, subs, settings]);

  const dirty = useMemo(() => row.categories.some((cat) => {
    const d = cats[cat.category_id];
    if (d && (d.mark_score !== str(cat.mark_score) || d.rachel_score !== str(cat.rachel_score))) return true;
    return cat.subcriteria.some((s) => {
      const sd = subs[s.subcriterion_id];
      return sd && (sd.mark_score !== str(s.mark_score) || sd.rachel_score !== str(s.rachel_score));
    });
  }), [row, cats, subs]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.saveCityScores(row.profile.id, row.categories.map((cat) => ({
        category_id: cat.category_id,
        score: null,
        mark_score: num(cats[cat.category_id]?.mark_score),
        rachel_score: num(cats[cat.category_id]?.rachel_score),
      })));
      const subRows = row.categories.flatMap((cat) => cat.subcriteria.map((s) => ({
        subcriterion_id: s.subcriterion_id,
        score: null,
        mark_score: num(subs[s.subcriterion_id]?.mark_score),
        rachel_score: num(subs[s.subcriterion_id]?.rachel_score),
      })));
      if (subRows.length) await api.saveCitySubScores(row.profile.id, subRows);
      await onChanged();
    } catch (e: any) { setError(String(e.message)); } finally { setSaving(false); }
  }

  async function rename() {
    try {
      await api.updateCity(row.profile.id, { name });
      setRenaming(false);
      await onChanged();
    } catch (e: any) { setError(String(e.message)); }
  }

  async function remove() {
    if (!confirm(
      `Delete ${row.profile.name}? Its ratings go with it and ${row.property_count} ` +
      `${row.property_count === 1 ? "property loses" : "properties lose"} their inherited scores.`
    )) return;
    try {
      await api.deleteCity(row.profile.id);
      await onChanged();
    } catch (e: any) { setError(String(e.message)); }
  }

  async function adopt(propertyId: number) {
    try {
      await api.useCityRatings(propertyId);
      await onChanged();
    } catch (e: any) { setError(String(e.message)); }
  }

  return (
    <section className="card">
      <div className="card-pad" style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ minWidth: 0 }}>
          <div className="cat-name" style={{ fontSize: 17 }}>{row.profile.name}</div>
          <div className="cat-desc">
            {row.property_count} {row.property_count === 1 ? "property" : "properties"}
            {row.overriding.length > 0 && (
              <span className="badge warn" style={{ marginLeft: 8 }}>
                {row.overriding.length} rated by hand
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center", marginLeft: "auto" }}>
          {live.map((cat) => (
            <div key={cat.category_id} style={{ textAlign: "right" }}>
              <div className="tiny muted">{cat.name}</div>
              <div className={`mono ${gradeClass(cat.grade)}`} style={{ fontWeight: 640 }}>
                {cat.grade ?? "—"} <span className="tiny faint">{fmtScore(cat.score, 0)}</span>
              </div>
            </div>
          ))}
        </div>
        <button className="btn sm ghost" onClick={() => setOpen((v) => !v)}>
          {open ? "Done" : "Rate"}
        </button>
      </div>

      {error && <div className="err" style={{ margin: "0 18px 14px" }}>{error}</div>}

      {open && (
        <>
          {live.map((cat) => (
            <div className="cat-card" key={cat.category_id}>
              <div className="cat-top">
                <div>
                  <div className="cat-name">{cat.name}</div>
                  <div className="cat-desc">
                    Weight {cat.weight}%
                    {cat.subcriteria.length > 0 && ` · from ${cat.subcriteria.length} subcriteria`}
                  </div>
                </div>
                <div className="cat-weight">
                  <ScoreGrade score={cat.score} grade={cat.grade} />
                </div>
              </div>

              {cat.subcriteria.length > 0 ? (
                <div style={{ marginTop: 12 }}>
                  <div className="sub-row tiny muted">
                    <span>Subcriterion</span>
                    <span style={{ textAlign: "center" }}>Mark</span>
                    <span style={{ textAlign: "center" }}>Rachel</span>
                    <span style={{ textAlign: "right" }}>Score</span>
                    <span />
                  </div>
                  {cat.subcriteria.map((s) => {
                    const sd = subs[s.subcriterion_id] ?? { mark_score: "", rachel_score: "" };
                    return (
                      <div className="sub-row" key={s.subcriterion_id}>
                        <span className="sub-name">
                          {s.name} <span className="tiny faint">{s.weight}%</span>
                        </span>
                        <input
                          value={sd.mark_score}
                          inputMode="numeric"
                          placeholder="—"
                          onChange={(e) => setSubs((d) => ({
                            ...d, [s.subcriterion_id]: { ...sd, mark_score: e.target.value },
                          }))}
                        />
                        <input
                          value={sd.rachel_score}
                          inputMode="numeric"
                          placeholder="—"
                          onChange={(e) => setSubs((d) => ({
                            ...d, [s.subcriterion_id]: { ...sd, rachel_score: e.target.value },
                          }))}
                        />
                        <span className="mono tiny" style={{ textAlign: "right" }}>
                          {fmtScore(s.score, 0)}
                        </span>
                        <span className={`tiny ${gradeClass(s.grade)}`} style={{ fontWeight: 600 }}>
                          {s.grade ?? ""}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="row" style={{ marginTop: 12, gridTemplateColumns: "1fr 1fr auto" }}>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>Mark</label>
                    <input
                      value={cats[cat.category_id]?.mark_score ?? ""}
                      inputMode="numeric"
                      placeholder="0–100"
                      onChange={(e) => setCats((d) => ({
                        ...d,
                        [cat.category_id]: { ...d[cat.category_id], mark_score: e.target.value },
                      }))}
                    />
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>Rachel</label>
                    <input
                      value={cats[cat.category_id]?.rachel_score ?? ""}
                      inputMode="numeric"
                      placeholder="0–100"
                      onChange={(e) => setCats((d) => ({
                        ...d,
                        [cat.category_id]: { ...d[cat.category_id], rachel_score: e.target.value },
                      }))}
                    />
                  </div>
                  <div style={{ alignSelf: "end", paddingBottom: 9 }}>
                    {cat.agreement != null && (
                      <span className={cat.disagreement_flag ? "badge warn" : "badge"}>
                        {cat.disagreement_flag ? "⚠ " : ""}gap {cat.agreement.toFixed(0)}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}

          {live.length === 0 && (
            <div className="card-pad tiny muted">
              No categories are rated by city yet. Tick “Rated once per city” on Schools,
              Safety or Location in Tuning.
            </div>
          )}

          {row.overriding.length > 0 && (
            <div className="card-pad" style={{ paddingTop: 0 }}>
              <div className="section-title">Properties ignoring these ratings</div>
              <div className="tiny muted" style={{ marginBottom: 10 }}>
                These have their own scores typed in, which beat the town's.
              </div>
              {row.overriding.map((p) => (
                <div
                  key={p.id}
                  style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "8px 0",
                    borderBottom: "1px solid var(--line-soft)",
                  }}
                >
                  <Link to={`/property/${p.id}`} style={{ color: "var(--accent)" }}>{p.name}</Link>
                  <span className="tiny faint">{p.categories.join(", ")}</span>
                  <button className="btn sm ghost" style={{ marginLeft: "auto" }} onClick={() => adopt(p.id)}>
                    Use {row.profile.name}'s ratings
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="card-pad" style={{ display: "flex", gap: 12, alignItems: "center", paddingTop: 4 }}>
            {renaming ? (
              <>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{ maxWidth: 220 }}
                  onKeyDown={(e) => { if (e.key === "Enter") rename(); }}
                />
                <button className="btn sm" onClick={rename}>Save name</button>
                <button className="btn sm ghost" onClick={() => { setName(row.profile.name); setRenaming(false); }}>
                  Cancel
                </button>
              </>
            ) : (
              <button className="btn sm ghost" onClick={() => setRenaming(true)}>Rename</button>
            )}
            <button className="btn sm danger" onClick={remove}>Delete city</button>
            <button className="btn primary" style={{ marginLeft: "auto" }} onClick={save} disabled={!dirty || saving}>
              {saving ? "Saving…" : dirty ? "Save ratings" : "Saved"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
