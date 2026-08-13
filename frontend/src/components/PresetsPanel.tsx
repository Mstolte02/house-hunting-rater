import { useEffect, useState } from "react";

import { api } from "../lib/api";
import type { Category } from "@shared/types";

type Preset = Awaited<ReturnType<typeof api.presets>>[number];

/**
 * Saved weighting configurations — Balanced, Financial, Mark's, Rachel's.
 *
 * Loading a preset only fills the live preview; nothing is committed until you hit
 * Save model, so you can try one on and back out.
 */
export default function PresetsPanel({
  categories,
  weights,
  onLoad,
}: {
  categories: Category[];
  weights: Record<number, number>;
  onLoad: (weights: Record<number, number>) => void;
}) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);

  async function refresh() {
    setPresets(await api.presets());
  }

  useEffect(() => {
    refresh().catch((e) => setError(String(e.message)));
  }, []);

  async function save() {
    if (!name.trim()) return;
    setError(null);
    try {
      await api.createPreset({
        name: name.trim(),
        weights: categories.map((c) => ({
          category_id: c.id,
          weight: weights[c.id] ?? c.weight,
        })),
      });
      setName("");
      setNaming(false);
      await refresh();
    } catch (e: any) {
      setError(String(e.message));
    }
  }

  function load(p: Preset) {
    const next: Record<number, number> = {};
    for (const c of categories) next[c.id] = c.weight;
    for (const w of p.weights) next[w.category_id] = w.weight;
    setActiveId(p.id);
    onLoad(next);
  }

  async function overwrite(p: Preset) {
    if (!confirm(`Overwrite "${p.name}" with the current weights?`)) return;
    await api.updatePreset(p.id, {
      weights: categories.map((c) => ({
        category_id: c.id,
        weight: weights[c.id] ?? c.weight,
      })),
    });
    await refresh();
  }

  return (
    <section className="card card-pad accent-indigo">
      <div style={{ display: "flex", alignItems: "center" }}>
        <div className="section-title" style={{ marginBottom: 0 }}>
          Model presets
        </div>
        <button
          className="btn sm"
          style={{ marginLeft: "auto" }}
          onClick={() => setNaming((v) => !v)}
        >
          {naming ? "Cancel" : "Save current"}
        </button>
      </div>

      {error && (
        <div className="err" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}

      {naming && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, marginTop: 12 }}>
          <input
            value={name}
            autoFocus
            placeholder="Balanced, Financial, Mark, Rachel…"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
          <button className="btn sm primary" onClick={save} disabled={!name.trim()}>
            Save
          </button>
        </div>
      )}

      {presets.length === 0 ? (
        <div className="tiny muted" style={{ marginTop: 12 }}>
          Save the weights you're using now, then try a different set without losing it.
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          {presets.map((p) => (
            <div
              key={p.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "9px 0",
                borderBottom: "1px solid var(--line-soft)",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>
                  {p.name}{" "}
                  {activeId === p.id && <span className="badge accent">loaded</span>}
                </div>
                <div className="tiny muted">
                  {p.weights.length} categories
                </div>
              </div>
              <button className="btn sm ghost" onClick={() => load(p)}>
                Load
              </button>
              <button className="btn sm ghost" onClick={() => overwrite(p)} title="Replace with current weights">
                ⟳
              </button>
              <button
                className="btn sm danger"
                onClick={async () => {
                  if (!confirm(`Delete preset "${p.name}"?`)) return;
                  await api.deletePreset(p.id);
                  if (activeId === p.id) setActiveId(null);
                  await refresh();
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
