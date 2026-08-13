/**
 * Similarity endpoints. Everything the Tuning page needs to see and reshape the curve,
 * plus the town list the Add Property page uses to bind a property to a dataset town.
 */

import { Router } from "express";

import { db, setSetting } from "../db/index.js";
import { getAdapter, invalidateAdapter, similaritySettings } from "../model.js";

export const similarity = Router();

similarity.get("/towns", (_req, res) => {
  const adapter = getAdapter();
  res.json(
    adapter.towns
      .map((t) => ({ name: t.name, county: t.county }))
      .sort((a, b) => a.name.localeCompare(b.name))
  );
});

/** Full ranked list + grade histogram + headline stats. */
similarity.get("/distribution", (_req, res) => {
  const adapter = getAdapter();
  res.json({
    summary: adapter.summary(),
    histogram: adapter.gradeDistribution(),
    towns: adapter.allScored(),
    settings: similaritySettings(),
    families: adapter.meta.families,
  });
});

/**
 * Preview a different curve/direction without saving it. The Tuning page calls this on
 * every slider move so you can see the grade histogram reshape live.
 */
similarity.post("/preview", (req, res) => {
  const { anchors, aPlusRaw, oneSided, referenceTown } = req.body ?? {};
  try {
    const adapter = getAdapter({
      ...(anchors ? { anchors } : {}),
      ...(aPlusRaw !== undefined ? { aPlusRaw } : {}),
      ...(oneSided !== undefined ? { oneSided } : {}),
      ...(referenceTown ? { referenceTown } : {}),
    });
    res.json({
      summary: adapter.summary(),
      histogram: adapter.gradeDistribution(),
      towns: adapter.allScored().slice(0, 30),
    });
  } catch (e: any) {
    res.status(400).json({ error: String(e.message ?? e) });
  }
});

similarity.put("/settings", (req, res) => {
  const { anchors, aPlusRaw, oneSided, referenceTown, qualityFeatures } = req.body ?? {};
  if (anchors) setSetting("curve_anchors", anchors);
  if (aPlusRaw !== undefined) setSetting("a_plus_raw", aPlusRaw);
  if (oneSided !== undefined) setSetting("one_sided", !!oneSided);
  if (referenceTown) setSetting("reference_town", referenceTown);
  if (qualityFeatures) setSetting("quality_features", qualityFeatures);
  invalidateAdapter();
  try {
    getAdapter(); // fail loudly here rather than on the next page load
  } catch (e: any) {
    return res.status(400).json({ error: String(e.message ?? e) });
  }
  res.json({ ok: true, settings: similaritySettings() });
});

/** Similarity detail for a single town — the "why" behind a Location grade. */
similarity.get("/town/:name", (req, res) => {
  const adapter = getAdapter();
  const town = adapter.matchTown(req.params.name);
  if (!town) return res.status(404).json({ error: "town not found in dataset" });
  res.json(adapter.similarityFor(town));
});
