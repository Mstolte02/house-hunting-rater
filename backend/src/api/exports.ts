/**
 * Export. Protects against losing the local database and makes it easy to pull the
 * ratings into a spreadsheet.
 *
 * Properties CSV carries the facts, the computed per-category scores and grades, and
 * the overall — one row per property, so it opens cleanly in Numbers or Excel.
 * Model JSON carries the whole configuration: categories, subcriteria, weights, grade
 * scale, deal breakers, presets and the similarity curve.
 */

import { Router } from "express";

import { db, getSetting } from "../db/index.js";
import { evaluate, getGradeScale, similaritySettings } from "../model.js";

export const exports_ = Router();

/** RFC 4180: quote anything containing a comma, quote or newline; double inner quotes. */
function cell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: (string | number | null)[][]): string {
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}

exports_.get("/export/properties.csv", (_req, res) => {
  const results = evaluate();
  const categoryNames = [
    ...new Set(results.flatMap((r) => r.categories.map((c) => c.name))),
  ];

  const header = [
    "Name", "Address", "City", "State", "ZIP", "Type", "Status",
    "Monthly Cost", "HOA", "Taxes", "Insurance", "Utilities",
    "Bedrooms", "Bathrooms", "Square Feet", "Year Built", "Garage",
    "Overall", "Grade", "Rank", "Deal Breakers",
    ...categoryNames.flatMap((n) => [n, `${n} Grade`]),
    "Notes", "Pros", "Cons", "Visit Notes", "URL",
  ];

  const rows = results.map((r) => {
    const p = r.property;
    const byName = new Map(r.categories.map((c) => [c.name, c]));
    return [
      p.name, p.address, p.city, p.state, p.zip, p.property_type, p.status,
      p.monthly_cost, p.hoa, p.property_taxes, p.insurance, p.utilities,
      p.bedrooms, p.bathrooms, p.square_feet, p.year_built, p.garage_spaces,
      r.overall == null ? null : Number(r.overall.toFixed(2)),
      r.grade, r.rank, r.failed_deal_breakers.join("; "),
      ...categoryNames.flatMap((n) => {
        const c = byName.get(n);
        return [
          c?.score == null ? null : Number(c.score.toFixed(2)),
          c?.grade ?? null,
        ];
      }),
      p.notes, p.pros, p.cons, p.visit_notes, p.url,
    ];
  });

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="house-hunt-properties-${stamp}.csv"`
  );
  // BOM so Excel reads the UTF-8 correctly.
  res.send("﻿" + toCsv([header, ...rows]));
});

exports_.get("/export/model.json", (_req, res) => {
  const model = {
    exported: new Date().toISOString(),
    categories: db.prepare("SELECT * FROM categories ORDER BY sort_order").all(),
    subcriteria: db.prepare("SELECT * FROM subcriteria").all(),
    deal_breakers: db.prepare("SELECT * FROM deal_breakers").all(),
    presets: db.prepare("SELECT * FROM model_presets").all(),
    preset_weights: db.prepare("SELECT * FROM model_preset_weights").all(),
    grade_scale: getGradeScale(),
    rater_combine: getSetting("rater_combine", "average"),
    disagreement_threshold: getSetting("disagreement_threshold", 15),
    similarity: similaritySettings(),
  };
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "application/json");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="house-hunt-model-${stamp}.json"`
  );
  res.send(JSON.stringify(model, null, 2));
});
