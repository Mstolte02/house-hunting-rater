import { Router } from "express";

import { db } from "../db/index.js";
import type { Category, Subcriterion } from "../../../shared/types.js";

export const categories = Router();

/** A row is external exactly when it names a metric; there is no third state. */
function methodFor(metric: unknown): "manual" | "external" {
  return metric ? "external" : "manual";
}

categories.get("/", (_req, res) => {
  const cats = (db
    .prepare("SELECT * FROM categories ORDER BY sort_order")
    .all() as any[]).map((c) => ({ ...c, enabled: !!c.enabled }));
  const subs = (db.prepare("SELECT * FROM subcriteria").all() as any[]).map((s) => ({
    ...s,
    enabled: !!s.enabled,
  }));
  res.json(
    cats.map((c: Category) => ({
      ...c,
      subcriteria: subs.filter((s: Subcriterion) => s.category_id === c.id),
    }))
  );
});

categories.post("/", (req, res) => {
  const { name, description, weight, metric, enabled } = req.body ?? {};
  if (!name) return res.status(400).json({ error: "name is required" });
  const m = metric || null;
  const next = db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM categories").get() as { n: number };
  try {
    const info = db
      .prepare(
        `INSERT INTO categories (name, description, weight, enabled, scoring_method, metric, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(name, description ?? null, Number(weight) || 0, enabled === false ? 0 : 1, methodFor(m), m, next.n);
    res.status(201).json(one(Number(info.lastInsertRowid)));
  } catch (e: any) {
    if (String(e.message).includes("UNIQUE")) {
      return res.status(409).json({ error: `A category named "${name}" already exists.` });
    }
    throw e;
  }
});

categories.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  const body = req.body ?? {};
  const fields: Record<string, unknown> = {};
  if ("name" in body) fields.name = body.name;
  if ("description" in body) fields.description = body.description ?? null;
  if ("weight" in body) fields.weight = Number(body.weight) || 0;
  if ("enabled" in body) fields.enabled = body.enabled ? 1 : 0;
  if ("metric" in body) {
    fields.metric = body.metric || null;
    fields.scoring_method = methodFor(fields.metric);
  }
  if ("sort_order" in body) fields.sort_order = Number(body.sort_order) || 0;

  const keys = Object.keys(fields);
  if (keys.length) {
    db.prepare(
      `UPDATE categories SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`
    ).run(...keys.map((k) => fields[k] as never), id);
  }
  res.json(one(id));
});

/** Bulk weight update — what the Tuning page saves when you commit a preview. */
categories.put("/", (req, res) => {
  const rows = Array.isArray(req.body?.weights) ? req.body.weights : [];
  const stmt = db.prepare("UPDATE categories SET weight = ? WHERE id = ?");
  db.transaction(() => {
    for (const r of rows) stmt.run(Number(r.weight) || 0, Number(r.category_id));
  })();
  res.json({ ok: true });
});

categories.delete("/:id", (req, res) => {
  // Scores and subcriteria cascade, so removing a category cleans up after itself.
  db.prepare("DELETE FROM categories WHERE id = ?").run(Number(req.params.id));
  res.status(204).end();
});

categories.post("/:id/subcriteria", (req, res) => {
  const category_id = Number(req.params.id);
  const { name, weight, enabled, metric } = req.body ?? {};
  if (!name) return res.status(400).json({ error: "name is required" });
  db.prepare(
    "INSERT INTO subcriteria (category_id, name, weight, enabled, metric) VALUES (?, ?, ?, ?, ?)"
  ).run(category_id, name, Number(weight) || 1, enabled === false ? 0 : 1, metric || null);
  res.status(201).json(one(category_id));
});

categories.put("/subcriteria/:subId", (req, res) => {
  const id = Number(req.params.subId);
  const body = req.body ?? {};
  const { name, weight, enabled } = body;
  const fields: Record<string, unknown> = {};
  if (name != null) fields.name = name;
  if (weight != null) fields.weight = Number(weight) || 0;
  if (enabled != null) fields.enabled = enabled ? 1 : 0;
  if ("metric" in body) fields.metric = body.metric || null;
  const keys = Object.keys(fields);
  if (keys.length) {
    db.prepare(
      `UPDATE subcriteria SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`
    ).run(...keys.map((k) => fields[k] as never), id);
  }
  res.json({ ok: true });
});

categories.delete("/subcriteria/:subId", (req, res) => {
  db.prepare("DELETE FROM subcriteria WHERE id = ?").run(Number(req.params.subId));
  res.status(204).end();
});

function one(id: number) {
  const c = db.prepare("SELECT * FROM categories WHERE id = ?").get(id) as any;
  if (!c) return null;
  const subs = (db
    .prepare("SELECT * FROM subcriteria WHERE category_id = ?")
    .all(id) as any[]).map((s) => ({ ...s, enabled: !!s.enabled }));
  return { ...c, enabled: !!c.enabled, subcriteria: subs };
}
