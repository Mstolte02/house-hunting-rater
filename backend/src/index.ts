/**
 * Local API server. Binds to 127.0.0.1 only — this app is for one laptop, and there is
 * no auth because nothing is ever exposed off the machine.
 */

import express from "express";

import { categories } from "./api/categories.js";
import { exports_ } from "./api/exports.js";
import { model } from "./api/model.js";
import { photos } from "./api/photos.js";
import { properties } from "./api/properties.js";
import { similarity } from "./api/similarity.js";
import { getAdapter } from "./model.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

// Photos mount first: its routes are more specific than properties' /:id handlers.
app.use("/api/properties", photos);
app.use("/api/properties", properties);
app.use("/api/categories", categories);
app.use("/api/similarity", similarity);
app.use("/api", exports_);
app.use("/api", model);

app.get("/api/health", (_req, res) => {
  const adapter = getAdapter();
  res.json({ ok: true, similarity: adapter.summary() });
});

// Surface real errors instead of an opaque 500 — this is a personal tool.
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: String(err?.message ?? err) });
});

// Deliberately not PORT: the dev launcher sets that for the web tier, and the API
// stealing it leaves Vite on a drifted port proxying to nothing.
const PORT = Number(process.env.HOUSING_API_PORT ?? 5190);
app.listen(PORT, "127.0.0.1", () => {
  try {
    const s = getAdapter().summary();
    console.log(
      `housing-rater api on http://127.0.0.1:${PORT}\n` +
        `  similarity: ${s.n_towns} towns vs ${s.reference}, ` +
        `one-sided=${s.one_sided}, A+ anchor raw ${s.a_plus_raw.toFixed(1)} ` +
        `(snapshot ${s.generated})`
    );
  } catch (e) {
    console.warn(`housing-rater api on http://127.0.0.1:${PORT} (similarity unavailable: ${e})`);
  }
});
