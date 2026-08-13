import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "../lib/api";
import { fmtScore, gradeClass } from "../lib/format";
import type { CurveAnchor } from "@shared/similarity/curve";

type Dist = Awaited<ReturnType<typeof api.distribution>>;

/**
 * The Indiana Similarity model's controls and its distribution.
 *
 * Sliding an anchor previews on the server (the curve is a whole-state recompute) and
 * redraws the histogram, so you can see how many towns land in each grade before saving.
 */
export default function SimilarityPanel() {
  const [dist, setDist] = useState<Dist | null>(null);
  const [anchors, setAnchors] = useState<CurveAnchor[]>([]);
  const [oneSided, setOneSided] = useState(true);
  const [preview, setPreview] = useState<{
    histogram: { grade: string; count: number }[];
    towns: Dist["towns"];
    summary: { a_plus_raw: number };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const timer = useRef<number>();

  useEffect(() => {
    api.distribution().then((d) => {
      setDist(d);
      setAnchors(d.settings.anchors);
      setOneSided(d.settings.oneSided);
    }).catch((e) => setError(String(e.message)));
  }, []);

  // Debounced so dragging a slider doesn't fire a request per pixel.
  useEffect(() => {
    if (!dist) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      api.previewSimilarity({ anchors, oneSided })
        .then(setPreview)
        .catch((e) => setError(String(e.message)));
    }, 180);
    return () => window.clearTimeout(timer.current);
  }, [anchors, oneSided, dist]);

  const dirty = useMemo(() => {
    if (!dist) return false;
    return (
      oneSided !== dist.settings.oneSided ||
      JSON.stringify(anchors) !== JSON.stringify(dist.settings.anchors)
    );
  }, [dist, anchors, oneSided]);

  if (error) return <div className="err">{error}</div>;
  if (!dist) return <div className="card card-pad muted">Loading similarity model…</div>;

  const histogram = preview?.histogram ?? dist.histogram;
  const max = Math.max(1, ...histogram.map((h) => h.count));
  const top = (preview?.towns ?? dist.towns).filter((t) => !t.isReference).slice(0, 10);

  async function save() {
    await api.saveSimilaritySettings({ anchors, oneSided });
    const fresh = await api.distribution();
    setDist(fresh);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  return (
    <section className="card card-pad accent-purple">
      <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
        <div className="section-title" style={{ marginBottom: 0 }}>Indiana Similarity</div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {saved && <span className="badge ok">Saved</span>}
          <button className="btn sm primary" onClick={save} disabled={!dirty}>
            {dirty ? "Save curve" : "Saved"}
          </button>
        </div>
      </div>

      <div className="tiny faint" style={{ marginBottom: 12 }}>
        {dist.summary.n_towns} Indiana towns scored against{" "}
        <strong style={{ color: "var(--text)" }}>{dist.summary.reference}</strong>{" "}
        · snapshot {dist.summary.generated}
      </div>

      <div className="note" style={{ marginBottom: 14 }}>
        Raw similarity tops out around {fmtScore(dist.summary.raw_max)} and its median is{" "}
        {fmtScore(dist.summary.raw_median)} — so grades come from where a town falls in that
        distribution, not from the raw number. A+ starts at raw{" "}
        {fmtScore(preview?.summary.a_plus_raw ?? dist.summary.a_plus_raw)}.
      </div>

      <label className="checkline" style={{ marginBottom: 14 }}>
        <input
          type="checkbox"
          checked={oneSided}
          onChange={(e) => setOneSided(e.target.checked)}
        />
        Being better than {dist.summary.reference} never costs points
        <span className="faint tiny">
          (safety, schools, income, wages)
        </span>
      </label>

      <div className="section-title">Grade distribution</div>
      <div className="hist" style={{ marginBottom: 16 }}>
        {histogram.map((h) => (
          <div className="hist-row" key={h.grade}>
            <span className={gradeClass(h.grade)} style={{ fontWeight: 640 }}>{h.grade}</span>
            <div
              className="hist-bar"
              style={{
                width: `${(h.count / max) * 100}%`,
                background: `var(--${h.grade[0].toLowerCase()})`,
              }}
            />
            <span className="n">{h.count}</span>
          </div>
        ))}
      </div>

      <div className="section-title">Curve anchors</div>
      <div className="tiny faint" style={{ marginBottom: 10 }}>
        What app score a town gets at each percentile of the state.
      </div>
      {anchors.map((a, i) => (
        <div key={a.percentile} style={{ display: "grid", gridTemplateColumns: "58px 1fr 42px", gap: 10, alignItems: "center", marginBottom: 7 }}>
          <span className="tiny faint mono">p{a.percentile}</span>
          <input
            type="range" min={0} max={100} step={1} value={a.score}
            onChange={(e) => {
              const v = Number(e.target.value);
              setAnchors((prev) => prev.map((p, j) => (j === i ? { ...p, score: v } : p)));
            }}
          />
          <span className="mono tiny" style={{ textAlign: "right" }}>{a.score}</span>
        </div>
      ))}

      <div className="section-title" style={{ marginTop: 18 }}>
        Most like {dist.summary.reference}
      </div>
      {top.map((t, i) => (
        <div className="preview-row" key={t.town}>
          <span className="pos">{i + 1}</span>
          <span>{t.town}<span className="faint tiny">{t.county ? ` · ${t.county}` : ""}</span></span>
          <span className="mono tiny faint">{fmtScore(t.raw, 0)} raw</span>
          <span className={gradeClass(t.grade)} style={{ fontWeight: 640, minWidth: 26, textAlign: "right" }}>
            {t.grade}
          </span>
        </div>
      ))}
    </section>
  );
}
