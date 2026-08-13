import { createHash, randomBytes } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const password = process.env.HOUSE_HUNT_PASSWORD;
if (!password) throw new Error("HOUSE_HUNT_PASSWORD is required.");

const data = JSON.parse(readFileSync(path.join(root, "frontend/src/data/seed.json"), "utf8"));
// Retained for schema compatibility; the Worker uses one fast salted SHA-256
// digest to stay inside the free plan's per-request CPU limit.
const iterations = 100_000;
const salt = randomBytes(16);
const hash = createHash("sha256").update(salt).update(password, "utf8").digest();
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const now = Date.now();
const sql = [
  `INSERT INTO house_hunt_state (id, data, revision, updated_at) VALUES ('main', ${quote(JSON.stringify(data))}, 1, ${now}) ON CONFLICT(id) DO NOTHING;`,
  `INSERT INTO house_hunt_config (id, password_salt, password_hash, password_iterations, updated_at) VALUES ('editor', ${quote(salt.toString("base64"))}, ${quote(hash.toString("base64"))}, ${iterations}, ${now}) ON CONFLICT(id) DO UPDATE SET password_salt=excluded.password_salt, password_hash=excluded.password_hash, password_iterations=excluded.password_iterations, updated_at=excluded.updated_at;`,
].join("\n");

const seedPath = path.join(root, "worker/.seed.sql");
try {
  writeFileSync(seedPath, sql, { encoding: "utf8", mode: 0o600 });
  const result = spawnSync(
    process.execPath,
    [path.join(root, "node_modules/wrangler/bin/wrangler.js"), "d1", "execute", "DB", "--config", "worker/wrangler.jsonc", "--remote", "--file", "worker/.seed.sql"],
    { cwd: root, encoding: "utf8", stdio: "inherit", env: process.env },
  );
  if (result.status !== 0) throw new Error(`D1 initialization failed with exit code ${result.status}.`);
} finally {
  rmSync(seedPath, { force: true });
}
