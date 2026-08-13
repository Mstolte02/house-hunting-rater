import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { api, type PropertyDetail as Detail } from "../lib/api";
import { fmtMoney, fmtScore, gradeClass, ordinal } from "../lib/format";
import { ScoreGrade } from "../components/GradeBadge";
import PhotosCard from "../components/PhotosCard";
import { calculateCategoryScore } from "@shared/scoring/category";
import { calculateOverallScore } from "@shared/scoring/overall";
import { DEFAULT_GRADE_SCALE, type GradeBand } from "@shared/scoring/grade";
import type { CategoryResult, RaterCombine } from "@shared/types";

type CatDraft = {
  mark_score: string;
  rachel_score: string;
  score: string;
  override_score: string;
  override_reason: string;
};
type SubDraft = { mark_score: string; rachel_score: string };

const str = (v: number | null) => (v == null ? "" : String(v));

export default function PropertyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [draft, setDraft] = useState<Record<number, CatDraft>>({});
  const [subDraft, setSubDraft] = useState<Record<number, SubDraft>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(true);
  const [settings, setSettings] = useState<{
    gradeScale: GradeBand[];
    raterCombine: RaterCombine;
    disagreementThreshold: number;
  }>({
    gradeScale: DEFAULT_GRADE_SCALE,
    raterCombine: "average",
    disagreementThreshold: 15,
  });

  function load(d: Detail) {
    setDetail(d);
    const cats: Record<number, CatDraft> = {};
    const subs: Record<number, SubDraft> = {};
    for (const c of d.categories) {
      cats[c.category_id] = {
        mark_score: str(c.mark_score),
        rachel_score: str(c.rachel_score),
        score: "",
        override_score: c.overridden ? str(c.score) : "",
        override_reason: c.override_reason ?? "",
      };
      for (const s of c.subcriteria) {
        subs[s.subcriterion_id] = {
          mark_score: str(s.mark_score),
          rachel_score: str(s.rachel_score),
        };
      }
    }
    setDraft(cats);
    setSubDraft(subs);
  }

  useEffect(() => {
    if (!id) return;
    api.property(id).then(load).catch((e) => setError(String(e.message)));
  }, [id]);

  // Needed to reproduce the server's arithmetic exactly while typing.
  useEffect(() => {
    api.settings()
      .then((s) =>
        setSettings({
          gradeScale: s.gradeScale,
          raterCombine: s.raterCombine,
          disagreementThreshold: s.disagreementThreshold,
        })
      )
      .catch(() => {});
  }, []);

  /**
   * Scores as they stand right now, including whatever is half-typed in the boxes.
   *
   * This runs the very same `calculateCategoryScore` the API uses rather than a
   * simplified copy, so the number you watch move while entering Mark's and Rachel's
   * ratings is the number that gets saved — precedence, overrides, subcriteria roll-up
   * and all.
   */
  const live = useMemo(() => {
    if (!detail) return null;
    const num = (v: string | undefined) =>
      v == null || v.trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v);

    const categories: CategoryResult[] = detail.categories.map((c) => {
      const d = draft[c.category_id];
      const subScores = new Map(
        c.subcriteria.map((s) => {
          const sd = subDraft[s.subcriterion_id];
          return [
            s.subcriterion_id,
            {
              property_id: detail.property.id,
              subcriterion_id: s.subcriterion_id,
              score: null,
              mark_score: num(sd?.mark_score),
              rachel_score: num(sd?.rachel_score),
            },
          ] as const;
        })
      );

      return calculateCategoryScore({
        category: {
          id: c.category_id,
          name: c.name,
          description: null,
          weight: c.weight,
          enabled: c.enabled,
          scoring_method: c.external_score == null ? "manual" : "external",
          metric: null,
          single_score: c.single_score,
          sort_order: 0,
        },
        score: {
          property_id: detail.property.id,
          category_id: c.category_id,
          score: null,
          mark_score: num(d?.mark_score),
          rachel_score: num(d?.rachel_score),
          override_score: num(d?.override_score),
          override_reason: d?.override_reason || null,
          notes: null,
        },
        subcriteria: c.subcriteria.map((s) => ({
          id: s.subcriterion_id,
          category_id: c.category_id,
          name: s.name,
          weight: s.weight,
          enabled: true,
          metric: s.metric,
        })),
        subScores,
        externalScore: c.external_score,
        externalSubScores: new Map(
          c.subcriteria.map((s) => [s.subcriterion_id, s.computed_score])
        ),
        combine: settings.raterCombine,
        gradeScale: settings.gradeScale,
        disagreementThreshold: settings.disagreementThreshold,
      });
    });

    const overall = calculateOverallScore(categories, settings.gradeScale);
    return { categories, ...overall };
  }, [detail, draft, subDraft, settings]);

  const dirty = useMemo(() => {
    if (!detail) return false;
    return detail.categories.some((c) => {
      const d = draft[c.category_id];
      if (!d) return false;
      const catChanged =
        d.mark_score !== str(c.mark_score) ||
        d.rachel_score !== str(c.rachel_score) ||
        d.override_score !== (c.overridden ? str(c.score) : "") ||
        d.override_reason !== (c.override_reason ?? "");
      const subChanged = c.subcriteria.some((s) => {
        const sd = subDraft[s.subcriterion_id];
        return (
          sd &&
          (sd.mark_score !== str(s.mark_score) || sd.rachel_score !== str(s.rachel_score))
        );
      });
      return catChanged || subChanged;
    });
  }, [detail, draft, subDraft]);

  async function save() {
    if (!detail) return;
    setSaving(true);
    setError(null);
    const num = (v: string) => (v === "" ? null : Number(v));
    try {
      const scores = detail.categories.map((c) => {
        const d = draft[c.category_id];
        return {
          category_id: c.category_id,
          score: num(d.score),
          mark_score: num(d.mark_score),
          rachel_score: num(d.rachel_score),
          override_score: num(d.override_score),
          override_reason: d.override_reason || null,
        };
      });
      const subScores = Object.entries(subDraft).map(([subId, s]) => ({
        subcriterion_id: Number(subId),
        score: null,
        mark_score: num(s.mark_score),
        rachel_score: num(s.rachel_score),
      }));

      await api.saveScores(detail.property.id, scores);
      const fresh = subScores.length
        ? await api.saveSubScores(detail.property.id, subScores)
        : await api.property(detail.property.id);
      load(fresh);
    } catch (e: any) {
      setError(String(e.message));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!detail) return;
    if (!confirm(`Delete "${detail.property.name}"? This cannot be undone.`)) return;
    await api.deleteProperty(detail.property.id);
    navigate("/");
  }

  if (error) return <div className="err">{error}</div>;
  if (!detail) return <div className="empty">Loading…</div>;

  const p = detail.property;
  const failed = detail.failed_deal_breakers.length > 0;

  // Everything below shows the live figures, so the page reflects what you've typed.
  const liveOverall = live?.overall ?? detail.overall;
  const liveGrade = live?.grade ?? detail.grade;
  const liveContributions = live?.contributions ?? detail.contributions;
  const liveEffectiveWeight = live?.effective_weight ?? detail.effective_weight;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{p.name}</h1>
          <div className="sub">
            {[p.address, p.city, p.state, p.zip].filter(Boolean).join(", ") || "No address"}
            {p.url && (
              <>
                {" · "}
                <a href={p.url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                  Listing ↗
                </a>
              </>
            )}
          </div>
        </div>
        <div className="spacer" />
        <Link to={`/property/${p.id}/edit`} className="btn ghost">Edit details</Link>
        <button className="btn danger" onClick={remove}>Delete</button>
        <button className="btn primary" onClick={save} disabled={!dirty || saving}>
          {saving ? "Saving…" : dirty ? "Save ratings" : "Saved"}
        </button>
      </div>

      <div className="tune-grid">
        <div className="stack">
          {failed && (
            <div className="err">
              <strong>Excluded from ranking.</strong>{" "}
              {detail.failed_deal_breakers.join(" · ")}
            </div>
          )}

          <section className="card">
            <div className="card-pad" style={{ paddingBottom: 8 }}>
              <div className="section-title">Ratings</div>
              <div className="tiny muted">
                Score each 0–100. Enter Mark and Rachel separately where you disagree —
                the model averages them and flags a wide gap.
              </div>
            </div>
            {(live?.categories ?? detail.categories).map((c) => (
              <CategoryRow
                key={c.category_id}
                cat={c}
                draft={draft[c.category_id]}
                subDraft={subDraft}
                onChange={(patch) =>
                  setDraft((d) => ({
                    ...d,
                    [c.category_id]: { ...d[c.category_id], ...patch },
                  }))
                }
                onSubChange={(subId, patch) =>
                  setSubDraft((d) => ({ ...d, [subId]: { ...d[subId], ...patch } }))
                }
              />
            ))}
          </section>

          <PhotosCard propertyId={p.id} />

          <section className="card card-pad">
            <div className="section-title">Notes</div>
            <NoteBlock title="General" body={p.notes} />
            <div className="row">
              <NoteBlock title="Pros" body={p.pros} />
              <NoteBlock title="Cons" body={p.cons} />
            </div>
            <NoteBlock title="Visit notes" body={p.visit_notes} />
          </section>
        </div>

        <div className="stack sticky">
          <section className="card card-pad">
            <div className="hero" style={{ padding: 0 }}>
              <div className={`hero-grade ${gradeClass(liveGrade)}`}>
                {liveGrade ?? "—"}
              </div>
              <div className="hero-meta">
                <div className="hero-score">{fmtScore(liveOverall)}</div>
                <div className="hero-sub">
                  {detail.rank
                    ? `Ranked ${ordinal(detail.rank)}`
                    : failed
                    ? "Not ranked"
                    : "Unscored"}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 16, display: "flex", gap: 20 }}>
              <Stat label="Monthly" value={fmtMoney(p.monthly_cost)} />
              <Stat label="Beds" value={p.bedrooms == null ? "—" : String(p.bedrooms)} />
              <Stat label="Baths" value={p.bathrooms == null ? "—" : String(p.bathrooms)} />
              <Stat
                label="Sq ft"
                value={p.square_feet == null ? "—" : p.square_feet.toLocaleString()}
              />
            </div>
          </section>

          <section className="card card-pad">
            <div style={{ display: "flex", alignItems: "center" }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                How this score was built
              </div>
              <button
                className="btn sm ghost"
                style={{ marginLeft: "auto" }}
                onClick={() => setShowBreakdown((s) => !s)}
              >
                {showBreakdown ? "Hide" : "Show"}
              </button>
            </div>
            {showBreakdown && (
              <div style={{ marginTop: 14 }}>
                <div className="breakdown-row muted tiny">
                  <span className="lbl">Category</span>
                  <span style={{ textAlign: "right" }}>Score</span>
                  <span style={{ textAlign: "right" }}>Weight</span>
                  <span style={{ textAlign: "right" }}>Adds</span>
                </div>
                {liveContributions.map((l) => (
                  <div className="breakdown-row" key={l.name}>
                    <span className="lbl">{l.name}</span>
                    <span style={{ textAlign: "right" }}>{fmtScore(l.score)}</span>
                    <span style={{ textAlign: "right" }}>
                      {(l.normalized_weight * 100).toFixed(1)}%
                    </span>
                    <span style={{ textAlign: "right" }}>{l.contribution.toFixed(2)}</span>
                  </div>
                ))}
                <div className="breakdown-row total">
                  <span className="lbl">Overall</span>
                  <span />
                  <span />
                  <span style={{ textAlign: "right" }}>{fmtScore(liveOverall, 2)}</span>
                </div>
                {liveEffectiveWeight !== 100 && (
                  <div className="tiny muted" style={{ marginTop: 10 }}>
                    Weights of scored categories total {liveEffectiveWeight}%, so
                    they're normalized to 100% here.
                  </div>
                )}
              </div>
            )}
          </section>

          {(detail.commutes.length > 0 || detail.commutes_missing.length > 0) && (
            <CommuteCard
              propertyId={p.id}
              commutes={detail.commutes}
              missing={detail.commutes_missing}
              onRefreshed={load}
            />
          )}
          {detail.similarity && <SimilarityCard sim={detail.similarity} />}
        </div>
      </div>
    </>
  );
}

function CategoryRow({
  cat,
  draft,
  subDraft,
  onChange,
  onSubChange,
}: {
  cat: CategoryResult;
  draft: CatDraft | undefined;
  subDraft: Record<number, SubDraft>;
  onChange: (patch: Partial<CatDraft>) => void;
  onSubChange: (subId: number, patch: Partial<SubDraft>) => void;
}) {
  const [showOverride, setShowOverride] = useState(cat.overridden);
  if (!draft) return null;

  const hasSubs = cat.subcriteria.length > 0;
  // A category fed by a metric isn't ours to rate — the model produces it. Showing
  // rater boxes invited typing a number that would silently beat the computed value.
  const automatic = !hasSubs && cat.external_score != null;

  return (
    <div className="cat-card">
      <div className="cat-top">
        <div>
          <div className="cat-name">
            {cat.name} {!cat.enabled && <span className="badge">disabled</span>}
          </div>
          <div className="cat-desc">
            Weight {cat.weight}%
            {automatic && " · scored automatically"}
            {hasSubs && ` · from ${cat.subcriteria.length} subcriteria`}
          </div>
        </div>
        <div className="cat-weight">
          <ScoreGrade score={cat.score} grade={cat.grade} />
        </div>
      </div>

      {automatic ? (
        <div style={{ marginTop: 10 }}>
          <div className="tiny muted">
            Calculated by the model — there's nothing to enter here.
          </div>
          {(cat.mark_score != null || cat.rachel_score != null) && (
            // Guards the footgun of hiding the inputs: a score saved before this
            // category became automatic would still win, invisibly.
            <div className="tiny" style={{ color: "var(--brass)", marginTop: 10 }}>
              A hand-entered score is saved here and is overriding the calculated{" "}
              {fmtScore(cat.external_score)}.{" "}
              <button
                className="btn sm ghost"
                onClick={() => onChange({ mark_score: "", rachel_score: "" })}
              >
                Clear it
              </button>
            </div>
          )}
        </div>
      ) : hasSubs ? (
        <div style={{ marginTop: 12 }}>
          <div className="sub-row tiny muted">
            <span>Subcriterion</span>
            <span style={{ textAlign: "center" }}>Mark</span>
            <span style={{ textAlign: "center" }}>Rachel</span>
            <span style={{ textAlign: "right" }}>Score</span>
            <span />
          </div>
          {cat.subcriteria.map((s) => {
            const sd = subDraft[s.subcriterion_id] ?? { mark_score: "", rachel_score: "" };
            const auto = Boolean(s.metric);
            return (
              <div className="sub-row" key={s.subcriterion_id}>
                <span className="sub-name">
                  {s.name}{" "}
                  <span className="tiny faint">{s.weight}%</span>
                  {auto && <span className="badge accent" style={{ marginLeft: 8 }}>auto</span>}
                </span>
                {auto ? (
                  // Drive times come from the routing engine; nothing to rate.
                  <span
                    className="tiny faint"
                    style={{ gridColumn: "span 2", textAlign: "center" }}
                  >
                    calculated
                  </span>
                ) : (
                  <>
                    <input
                      value={sd.mark_score}
                      inputMode="numeric"
                      placeholder="—"
                      onChange={(e) =>
                        onSubChange(s.subcriterion_id, { mark_score: e.target.value })
                      }
                    />
                    <input
                      value={sd.rachel_score}
                      inputMode="numeric"
                      placeholder="—"
                      onChange={(e) =>
                        onSubChange(s.subcriterion_id, { rachel_score: e.target.value })
                      }
                    />
                  </>
                )}
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
              value={draft.mark_score}
              onChange={(e) => onChange({ mark_score: e.target.value })}
              inputMode="numeric"
              placeholder="0–100"
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Rachel</label>
            <input
              value={draft.rachel_score}
              onChange={(e) => onChange({ rachel_score: e.target.value })}
              inputMode="numeric"
              placeholder="0–100"
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

      {cat.disagreement_flag && (
        <div className="tiny" style={{ color: "#fcd34d", marginTop: 10 }}>
          Big gap here — probably worth talking through rather than letting the model
          split it.
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        {!showOverride ? (
          <button className="btn sm ghost" onClick={() => setShowOverride(true)}>
            Override…
          </button>
        ) : (
          <div style={{ background: "var(--elevated)", borderRadius: 9, padding: 14 }}>
            <div className="row" style={{ gridTemplateColumns: "115px 1fr" }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Override</label>
                <input
                  value={draft.override_score}
                  onChange={(e) => onChange({ override_score: e.target.value })}
                  inputMode="numeric"
                  placeholder={fmtScore(cat.computed_score, 0)}
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Reason</label>
                <input
                  value={draft.override_reason}
                  onChange={(e) => onChange({ override_reason: e.target.value })}
                  placeholder="Five minutes from Rachel's parents"
                />
              </div>
            </div>
            <div className="tiny muted" style={{ marginTop: 10 }}>
              {cat.overridden
                ? `⚠️ Overriding the computed ${fmtScore(cat.computed_score)}. Clear the box to go back to the model.`
                : "Leave blank to use the model's value."}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CommuteCard({
  propertyId, commutes, missing, onRefreshed,
}: {
  propertyId: number;
  commutes: Detail["commutes"];
  missing: string[];
  onRefreshed: (d: Detail) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function recalc() {
    setBusy(true);
    setNote(null);
    try {
      const r = await api.refreshCommute(propertyId);
      onRefreshed(r.result);
      setNote(
        r.failed.length
          ? `Couldn't calculate an exact-address route for: ${r.failed.join(", ")}. Check the street address or try again.`
          : `Updated ${r.routed} route${r.routed === 1 ? "" : "s"}.`
      );
    } catch (e: any) {
      setNote(String(e.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card card-pad accent-teal">
      <div style={{ display: "flex", alignItems: "center" }}>
        <div className="section-title" style={{ marginBottom: 0 }}>Commute</div>
        <button className="btn sm ghost" style={{ marginLeft: "auto" }} onClick={recalc} disabled={busy}>
          {busy ? "Routing…" : "Recalculate"}
        </button>
      </div>

      <div style={{ marginTop: 12 }}>
        {commutes.map((c) => (
          <div
            key={c.destination}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto auto",
              gap: 12,
              alignItems: "baseline",
              padding: "9px 0",
              borderBottom: "1px solid var(--line-soft)",
            }}
          >
            <span>{c.label}</span>
            <span style={{ textAlign: "right" }}>
              <span className="mono" style={{ fontWeight: 600, fontSize: 15 }}>
                {Math.round(c.minutes)}
              </span>
              <span className="tiny muted"> min</span>
              <span className="tiny faint"> · {c.miles.toFixed(0)} mi</span>
            </span>
            <span className="mono" style={{ fontWeight: 600, minWidth: 34, textAlign: "right" }}>
              {c.score.toFixed(0)}
            </span>
          </div>
        ))}
      </div>

      {missing.length > 0 && (
        <div className="tiny" style={{ color: "#fcd34d", marginTop: 10 }}>
          No route yet for {missing.join(", ")} — hit Recalculate.
        </div>
      )}
      {note && <div className="tiny muted" style={{ marginTop: 10 }}>{note}</div>}

      <div className="tiny faint" style={{ marginTop: 10 }}>
        {commutes.length
          ? `Real driving routes from ${commutes[0].origin_label}.`
          : "Commute stays unscored until this property's exact street address can be located."}
      </div>
    </section>
  );
}

function SimilarityCard({ sim }: { sim: NonNullable<Detail["similarity"]> }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="card card-pad">
      <div style={{ display: "flex", alignItems: "center" }}>
        <div className="section-title" style={{ marginBottom: 0 }}>
          Indiana Similarity
        </div>
        <button
          className="btn sm ghost"
          style={{ marginLeft: "auto" }}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Hide" : "Detail"}
        </button>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 12 }}>
        <div className={gradeClass(sim.grade)} style={{ fontSize: 28, fontWeight: 700 }}>
          {sim.grade}
        </div>
        <div className="mono" style={{ fontSize: 17, fontWeight: 600 }}>
          {fmtScore(sim.score)}
        </div>
        <div className="tiny muted" style={{ marginLeft: "auto", textAlign: "right" }}>
          {sim.town}
          <br />
          {sim.percentile.toFixed(0)}th percentile in Indiana
        </div>
      </div>
      <div className="tiny faint" style={{ marginTop: 10 }}>
        Raw similarity to the reference town: {fmtScore(sim.raw)} / 100
        {sim.isReference && " — this is the reference town itself"}
      </div>
      {open && (
        <div style={{ marginTop: 14 }}>
          {[...sim.byFamily]
            .sort((a, b) => b.score - a.score)
            .map((f) => (
              <div className="catrow" key={f.family}>
                <span className="nm">{f.family}</span>
                <span className="sc">w {f.weight.toFixed(0)}</span>
                <span className="gd mono">{f.score.toFixed(0)}</span>
              </div>
            ))}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="tiny muted">{label}</div>
      <div className="mono" style={{ fontWeight: 600, fontSize: 15 }}>{value}</div>
    </div>
  );
}

function NoteBlock({ title, body }: { title: string; body: string | null }) {
  return (
    <div className="field">
      <label>{title}</label>
      <div className={body ? "" : "faint tiny"} style={{ whiteSpace: "pre-wrap" }}>
        {body || "—"}
      </div>
    </div>
  );
}
