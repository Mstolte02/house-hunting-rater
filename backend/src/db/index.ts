/**
 * SQLite connection + first-run seeding.
 *
 * The database is a plain file at data/housing.db — copyable, backup-able, and readable
 * with any SQLite tool. Nothing is kept in browser storage, so clearing Safari's data
 * can't take the ratings with it.
 */

import Database from "better-sqlite3";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..", "..", "..");
export const DATA_DIR = join(ROOT, "data");
const DB_PATH = process.env.HOUSING_DB ?? join(DATA_DIR, "housing.db");

mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(readFileSync(join(HERE, "schema.sql"), "utf8"));

/** CREATE TABLE IF NOT EXISTS won't add columns to a database that already exists. */
function addColumn(table: string, column: string, decl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}
addColumn("categories", "metric", "TEXT");
addColumn("subcriteria", "metric", "TEXT");
addColumn("categories", "single_score", "INTEGER NOT NULL DEFAULT 0");

// "formula" and "hybrid" were selectable but had nothing behind them; automatic scoring
// is a named metric now. Fold the old values into the two that mean something.
db.exec(`
  UPDATE categories SET scoring_method = 'manual'
   WHERE scoring_method NOT IN ('manual', 'external');
  UPDATE categories SET metric = 'similarity:westfield'
   WHERE metric IS NULL AND scoring_method = 'external';
  UPDATE categories SET scoring_method = CASE WHEN metric IS NULL THEN 'manual' ELSE 'external' END;
`);

/** Spec sec.6 defaults. Only inserted when the categories table is empty. */
const DEFAULT_CATEGORIES: [string, string, number, string][] = [
  ["Westfield Similarity", "How much this town resembles Westfield.", 20, "external"],
  ["Affordability", "What it costs relative to what we can carry.", 20, "manual"],
  ["House / Apartment", "The building itself: layout, space, kitchen, storage.", 15, "manual"],
  ["Neighborhood", "Safety, walkability, noise, general feel.", 15, "manual"],
  ["Commute", "Drive time to work and the places we go weekly.", 10, "manual"],
  ["Amenities", "What comes with it — pool, gym, yard, garage.", 7.5, "manual"],
  ["Condition", "Age, wear, and what we'd have to fix.", 7.5, "manual"],
  ["Intangibles", "How it feels. The stuff the model can't see.", 5, "manual"],
];

const DEFAULT_DEAL_BREAKERS: [string, string, string, number][] = [
  ["Monthly cost over budget", "monthly_cost", "max", 3000],
  ["Fewer than 2 bedrooms", "bedrooms", "min", 2],
  ["Under 900 sq ft", "square_feet", "min", 900],
  ["Overall score below 60", "overall", "min", 60],
];

export function seed(): void {
  const count = db.prepare("SELECT COUNT(*) AS n FROM categories").get() as {
    n: number;
  };
  if (count.n === 0) {
    const insert = db.prepare(
      `INSERT INTO categories (name, description, weight, enabled, scoring_method, sort_order)
       VALUES (?, ?, ?, 1, ?, ?)`
    );
    DEFAULT_CATEGORIES.forEach(([name, desc, weight, method], i) => {
      insert.run(name, desc, weight, method, i);
    });
  }

  const dbCount = db.prepare("SELECT COUNT(*) AS n FROM deal_breakers").get() as {
    n: number;
  };
  if (dbCount.n === 0) {
    const insert = db.prepare(
      `INSERT INTO deal_breakers (label, field, comparator, value, enabled)
       VALUES (?, ?, ?, ?, 0)`
    );
    // Seeded disabled — they're suggestions until you decide the real thresholds.
    DEFAULT_DEAL_BREAKERS.forEach(([label, field, cmp, value]) =>
      insert.run(label, field, cmp, value)
    );
  }
}

export function getSetting<T>(key: string, fallback: T): T {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, JSON.stringify(value));
}

seed();
