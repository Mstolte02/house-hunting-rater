import { Router } from "express";

import { db } from "../db/index.js";
import { evaluate, loadModelConfig, similarityForProperty } from "../model.js";
import {
  clearCommutes,
  commutesFor,
  missingCommutes,
  refreshCommutes,
  resolveMetrics,
} from "../metrics.js";
import { leadPhoto } from "./photos.js";
import { evaluateProperty } from "../../../shared/scoring/engine.js";
import type { SortKey } from "../../../shared/scoring/ranking.js";
import type { Property, PropertyScore, SubcriterionScore } from "../../../shared/types.js";

export const properties = Router();

/** Columns a client is allowed to write. Anything else in the body is ignored. */
const WRITABLE = [
  "name", "address", "city", "state", "zip", "url", "property_type", "status",
  "monthly_cost", "hoa", "property_taxes", "insurance", "utilities", "deposit",
  "move_in_costs", "bedrooms", "bathrooms", "square_feet", "lot_size", "year_built",
  "garage_spaces", "parking", "latitude", "longitude", "similarity_town",
  "notes", "pros", "cons", "visit_notes",
] as const;

/**
 * Fields that must land in the database as numbers. SQLite happily stores text in a
 * REAL column, so without this a typo in a cost box becomes a NaN on the dashboard and
 * silently breaks deal-breaker comparisons.
 */
const NUMERIC = new Set([
  "monthly_cost", "hoa", "property_taxes", "insurance", "utilities", "deposit",
  "move_in_costs", "bedrooms", "bathrooms", "square_feet", "lot_size", "year_built",
  "garage_spaces", "latitude", "longitude",
]);

function pick(body: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of WRITABLE) {
    if (!(k in body)) continue;
    const raw = body[k];
    if (raw === "" || raw == null) {
      out[k] = null;
    } else if (NUMERIC.has(k)) {
      const n = Number(raw);
      out[k] = Number.isFinite(n) ? n : null;
    } else {
      out[k] = raw;
    }
  }
  return out;
}

function parseSort(q: unknown): SortKey {
  const s = typeof q === "string" ? q : "overall";
  if (["overall", "price", "newest", "favorite"].includes(s)) return s as SortKey;
  if (s.startsWith("category:")) return { category: s.slice("category:".length) };
  return "overall";
}

properties.get("/", (req, res) => {
  res.json(
    evaluate(parseSort(req.query.sort)).map((r) => ({
      ...r,
      lead_photo: leadPhoto(r.property.id),
    }))
  );
});

properties.post("/", async (req, res) => {
  const data = pick(req.body ?? {});
  if (!data.name) return res.status(400).json({ error: "name is required" });
  const keys = Object.keys(data);
  const info = db
    .prepare(
      `INSERT INTO properties (${keys.join(", ")})
       VALUES (${keys.map(() => "?").join(", ")})`
    )
    .run(...keys.map((k) => data[k] as never));
  const id = Number(info.lastInsertRowid);

  // Geocode + route once, now, so the property has real drive times the moment you
  // open it. Failures leave the commute unscored rather than guessing.
  const property = db.prepare("SELECT * FROM properties WHERE id = ?").get(id) as Property;
  await refreshCommutes(property);

  res.status(201).json(getResult(id));
});

properties.get("/:id", (req, res) => {
  const result = getResult(Number(req.params.id));
  if (!result) return res.status(404).json({ error: "not found" });
  res.json(result);
});

properties.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const before = db.prepare("SELECT * FROM properties WHERE id = ?").get(id) as
    | Property
    | undefined;
  if (!before) return res.status(404).json({ error: "not found" });

  const data = pick(req.body ?? {});
  const keys = Object.keys(data);
  if (keys.length) {
    db.prepare(
      `UPDATE properties SET ${keys.map((k) => `${k} = ?`).join(", ")},
       updated_at = datetime('now') WHERE id = ?`
    ).run(...keys.map((k) => data[k] as never), id);
  }

  // Where it is changed, so the cached drive times are stale.
  const moved = (["address", "city", "state", "zip", "latitude", "longitude"] as const)
    .some((k) => k in data && data[k] !== (before as any)[k]);
  if (moved) {
    clearCommutes(id);
    const after = db.prepare("SELECT * FROM properties WHERE id = ?").get(id) as Property;
    await refreshCommutes(after);
  }

  const result = getResult(id);
  if (!result) return res.status(404).json({ error: "not found" });
  res.json(result);
});

/** Re-fetch drive times on demand — for when routing was down, or a curve changed. */
properties.post("/:id/commute/refresh", async (req, res) => {
  const id = Number(req.params.id);
  const property = db.prepare("SELECT * FROM properties WHERE id = ?").get(id) as
    | Property
    | undefined;
  if (!property) return res.status(404).json({ error: "not found" });
  const outcome = await refreshCommutes(property, { force: true });
  res.json({ ...outcome, result: getResult(id) });
});

properties.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM properties WHERE id = ?").run(Number(req.params.id));
  res.status(204).end();
});

/**
 * Upsert this property's category scores. Sending null for a field clears it, which is
 * how you remove a manual override.
 */
properties.put("/:id/scores", (req, res) => {
  const id = Number(req.params.id);
  const rows = Array.isArray(req.body?.scores) ? req.body.scores : [];
  const stmt = db.prepare(
    `INSERT INTO property_scores
       (property_id, category_id, score, mark_score, rachel_score, override_score, override_reason, notes)
     VALUES (@property_id, @category_id, @score, @mark_score, @rachel_score, @override_score, @override_reason, @notes)
     ON CONFLICT(property_id, category_id) DO UPDATE SET
       score = excluded.score,
       mark_score = excluded.mark_score,
       rachel_score = excluded.rachel_score,
       override_score = excluded.override_score,
       override_reason = excluded.override_reason,
       notes = excluded.notes`
  );
  db.transaction(() => {
    for (const r of rows) {
      stmt.run({
        property_id: id,
        category_id: r.category_id,
        score: num(r.score),
        mark_score: num(r.mark_score),
        rachel_score: num(r.rachel_score),
        override_score: num(r.override_score),
        override_reason: r.override_reason ?? null,
        notes: r.notes ?? null,
      });
    }
    db.prepare("UPDATE properties SET updated_at = datetime('now') WHERE id = ?").run(id);
  })();
  res.json(getResult(id));
});

properties.put("/:id/subscores", (req, res) => {
  const id = Number(req.params.id);
  const rows = Array.isArray(req.body?.scores) ? req.body.scores : [];
  const stmt = db.prepare(
    `INSERT INTO subcriteria_scores
       (property_id, subcriterion_id, score, mark_score, rachel_score)
     VALUES (@property_id, @subcriterion_id, @score, @mark_score, @rachel_score)
     ON CONFLICT(property_id, subcriterion_id) DO UPDATE SET
       score = excluded.score,
       mark_score = excluded.mark_score,
       rachel_score = excluded.rachel_score`
  );
  db.transaction(() => {
    for (const r of rows) {
      stmt.run({
        property_id: id,
        subcriterion_id: r.subcriterion_id,
        score: num(r.score),
        mark_score: num(r.mark_score),
        rachel_score: num(r.rachel_score),
      });
    }
  })();
  res.json(getResult(id));
});

/** Full detail for one property, including the similarity breakdown behind Location. */
export function getResult(id: number) {
  const property = db.prepare("SELECT * FROM properties WHERE id = ?").get(id) as
    | Property
    | undefined;
  if (!property) return null;

  const config = loadModelConfig();
  const similarity = similarityForProperty(property);
  const resolved = resolveMetrics(property);
  const externalScores: Record<number, number | null> = {};
  const externalSubScores: Record<number, number | null> = {};
  for (const c of config.categories) {
    if (c.metric) externalScores[c.id] = resolved[c.metric] ?? null;
  }
  for (const s of config.subcriteria) {
    if (s.metric) externalSubScores[s.id] = resolved[s.metric] ?? null;
  }

  const result = evaluateProperty(
    {
      property,
      scores: db
        .prepare("SELECT * FROM property_scores WHERE property_id = ?")
        .all(id) as PropertyScore[],
      subScores: db
        .prepare("SELECT * FROM subcriteria_scores WHERE property_id = ?")
        .all(id) as SubcriterionScore[],
      externalScores,
      externalSubScores,
    },
    config
  );

  // Rank comes from the full field, not from this property in isolation.
  const rank = evaluate().find((r) => r.property.id === id)?.rank ?? null;
  return {
    ...result,
    rank,
    similarity,
    commutes: commutesFor(property),
    commutes_missing: missingCommutes(property),
    lead_photo: leadPhoto(property.id),
  };
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
