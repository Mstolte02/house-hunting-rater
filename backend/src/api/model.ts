/**
 * Model configuration: grade scale, rater combine mode, deal breakers, weight presets,
 * and the ranking/compare views.
 */

import { Router } from "express";

import { db, getSetting, setSetting } from "../db/index.js";
import { evaluate, getGradeScale, invalidateAdapter } from "../model.js";
import { commuteSettings, metricRegistry } from "../metrics.js";
import { DEFAULT_GRADE_SCALE } from "../../../shared/scoring/grade.js";
import { DEFAULT_DISAGREEMENT_THRESHOLD } from "../../../shared/scoring/category.js";

export const model = Router();

/** Every automatic score source a category or subcriterion can point at. */
model.get("/metrics", (_req, res) => {
  res.json(metricRegistry());
});

model.get("/commute", (_req, res) => {
  res.json(commuteSettings());
});

model.put("/commute", (req, res) => {
  const { destinations, anchors } = req.body ?? {};
  if (Array.isArray(destinations)) {
    // A destination without usable coordinates would silently score every property the
    // same, so reject rather than store it.
    for (const d of destinations) {
      if (!d.key || !d.label) {
        return res.status(400).json({ error: "Each destination needs a key and a label." });
      }
      if (!Number.isFinite(Number(d.lat)) || !Number.isFinite(Number(d.lon))) {
        return res
          .status(400)
          .json({ error: `"${d.label}" needs numeric latitude and longitude.` });
      }
    }
    setSetting(
      "commute_destinations",
      destinations.map((d: any) => ({
        key: String(d.key),
        label: String(d.label),
        address: d.address ?? "",
        lat: Number(d.lat),
        lon: Number(d.lon),
      }))
    );
  }
  if (Array.isArray(anchors) && anchors.length) setSetting("commute_anchors", anchors);
  res.json({ ok: true, ...commuteSettings() });
});

model.get("/settings", (_req, res) => {
  res.json({
    gradeScale: getGradeScale(),
    raterCombine: getSetting("rater_combine", "average"),
    disagreementThreshold: getSetting(
      "disagreement_threshold",
      DEFAULT_DISAGREEMENT_THRESHOLD
    ),
    defaultGradeScale: DEFAULT_GRADE_SCALE,
  });
});

model.put("/settings", (req, res) => {
  const { gradeScale, raterCombine, disagreementThreshold } = req.body ?? {};
  if (Array.isArray(gradeScale) && gradeScale.length) {
    setSetting("grade_scale", gradeScale);
    invalidateAdapter(); // grades are baked into the similarity histogram
  }
  if (["average", "min", "max"].includes(raterCombine)) {
    setSetting("rater_combine", raterCombine);
  }
  if (disagreementThreshold != null) {
    setSetting("disagreement_threshold", Number(disagreementThreshold) || 0);
  }
  res.json({ ok: true });
});

// --- deal breakers ---

model.get("/deal-breakers", (_req, res) => {
  res.json(
    (db.prepare("SELECT * FROM deal_breakers ORDER BY id").all() as any[]).map((d) => ({
      ...d,
      enabled: !!d.enabled,
    }))
  );
});

model.post("/deal-breakers", (req, res) => {
  const { label, field, comparator, value, enabled } = req.body ?? {};
  if (!label || !field) {
    return res.status(400).json({ error: "label and field are required" });
  }
  const info = db
    .prepare(
      "INSERT INTO deal_breakers (label, field, comparator, value, enabled) VALUES (?, ?, ?, ?, ?)"
    )
    .run(label, field, comparator === "min" ? "min" : "max", Number(value) || 0, enabled ? 1 : 0);
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

model.put("/deal-breakers/:id", (req, res) => {
  const { label, field, comparator, value, enabled } = req.body ?? {};
  const fields: Record<string, unknown> = {};
  if (label != null) fields.label = label;
  if (field != null) fields.field = field;
  if (comparator != null) fields.comparator = comparator === "min" ? "min" : "max";
  if (value != null) fields.value = Number(value) || 0;
  if (enabled != null) fields.enabled = enabled ? 1 : 0;
  const keys = Object.keys(fields);
  if (keys.length) {
    db.prepare(
      `UPDATE deal_breakers SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`
    ).run(...keys.map((k) => fields[k] as never), Number(req.params.id));
  }
  res.json({ ok: true });
});

model.delete("/deal-breakers/:id", (req, res) => {
  db.prepare("DELETE FROM deal_breakers WHERE id = ?").run(Number(req.params.id));
  res.status(204).end();
});

// --- weight presets ---

model.get("/presets", (_req, res) => {
  const presets = db.prepare("SELECT * FROM model_presets ORDER BY id").all() as any[];
  const weights = db.prepare("SELECT * FROM model_preset_weights").all() as any[];
  res.json(
    presets.map((p) => ({
      ...p,
      weights: weights
        .filter((w) => w.preset_id === p.id)
        .map((w) => ({ category_id: w.category_id, weight: w.weight })),
    }))
  );
});

model.post("/presets", (req, res) => {
  const { name, description, weights } = req.body ?? {};
  if (!name) return res.status(400).json({ error: "name is required" });
  try {
    const info = db
      .prepare("INSERT INTO model_presets (name, description) VALUES (?, ?)")
      .run(name, description ?? null);
    const id = Number(info.lastInsertRowid);
    const stmt = db.prepare(
      "INSERT INTO model_preset_weights (preset_id, category_id, weight) VALUES (?, ?, ?)"
    );
    db.transaction(() => {
      for (const w of weights ?? []) stmt.run(id, Number(w.category_id), Number(w.weight) || 0);
    })();
    res.status(201).json({ id });
  } catch (e: any) {
    if (String(e.message).includes("UNIQUE")) {
      return res.status(409).json({ error: `A preset named "${name}" already exists.` });
    }
    throw e;
  }
});

model.put("/presets/:id", (req, res) => {
  const id = Number(req.params.id);
  const { name, description, weights } = req.body ?? {};
  if (name != null || description != null) {
    db.prepare(
      "UPDATE model_presets SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?"
    ).run(name ?? null, description ?? null, id);
  }
  if (Array.isArray(weights)) {
    const del = db.prepare("DELETE FROM model_preset_weights WHERE preset_id = ?");
    const ins = db.prepare(
      "INSERT INTO model_preset_weights (preset_id, category_id, weight) VALUES (?, ?, ?)"
    );
    db.transaction(() => {
      del.run(id);
      for (const w of weights) ins.run(id, Number(w.category_id), Number(w.weight) || 0);
    })();
  }
  res.json({ ok: true });
});

model.delete("/presets/:id", (req, res) => {
  db.prepare("DELETE FROM model_presets WHERE id = ?").run(Number(req.params.id));
  res.status(204).end();
});

// --- views ---

model.get("/rankings", (req, res) => {
  const sort = typeof req.query.sort === "string" ? req.query.sort : "overall";
  const key = sort.startsWith("category:")
    ? { category: sort.slice("category:".length) }
    : (sort as any);
  res.json(evaluate(key));
});

/** Side-by-side for the ids in ?ids=1,2,3 (spec caps this at 4 in the UI). */
model.get("/compare", (req, res) => {
  const ids = String(req.query.ids ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  const all = evaluate();
  res.json(ids.map((id) => all.find((r) => r.property.id === id)).filter(Boolean));
});
