# House Hunt — housing rating app

A personal decision model for evaluating houses and apartments. The repository includes
the current SQLite database and photos, plus a browser-ready snapshot for GitHub Pages.

```
housing-rater/
  shared/        scoring engine, city profiles + Indiana Similarity adapter (pure TS, no UI)
  backend/       express + better-sqlite3 API
  frontend/      React + Vite dashboard
  worker/        Cloudflare Worker API + D1 migrations
  data/
    housing.db       your properties and ratings
    similarity/      snapshot of the indiana-towns dataset
  tests/         vitest suite for the engine
```

## Running it

```
npm install     # once
npm run dev     # API on :5190, app on http://localhost:5191
npm test        # scoring engine tests
```

## GitHub Pages

Every push to `main` runs the test suite, builds the browser version, and deploys it with
the workflow in `.github/workflows/pages.yml`. In the repository settings, set **Pages →
Build and deployment → Source** to **GitHub Actions**.

GitHub Pages cannot run Express or SQLite. The hosted build therefore reads its shared
snapshot from a Cloudflare Worker backed by D1. Visitors can browse without signing in;
changes require an editor session obtained through the site's **Unlock** control. The
password verifier and session records remain server-side, while the browser keeps a local
fallback cache for temporary service interruptions.

To refresh the published snapshot after changing `data/housing.db` locally, regenerate
`frontend/src/data/seed.json` and copy any new files from `data/photos/` into
`frontend/public/data/photos/` before pushing.

Cloudflare source and migrations live in `worker/`. The production database is initialized
from the complete `frontend/src/data/seed.json` snapshot. The editor password is supplied
only through the `HOUSE_HUNT_PASSWORD` environment variable when running
`node scripts/initialize-cloudflare.mjs`; it is never committed.

Useful backend commands:

```sh
npm run worker:types
npm run worker:check
npm run worker:migrate
npm run worker:deploy
```

## How a score is built

```
property data -> category scores (0-100) -> weighted overall (0-100) -> letter grade
```

Grades are **only** a presentation layer. Nothing in the model ever does arithmetic on a
letter — every calculation runs on the underlying 0-100 value. Category weights are
normalized by the total weight of the categories that actually counted, so disabling a
category or leaving one unscored re-weights the rest instead of dragging the score down.

Every overall score is explainable: the property page shows each category's score,
normalized weight, and exact contribution, summing to the total.

### Where scores come from

Per category, highest precedence first:

1. **Manual override** — always shown with its reason, never applied silently
2. **Subcriteria** — weighted mean of the scored ones
3. **Mark / Rachel** — combined by average (configurable to min or max), with the gap
   surfaced and flagged past a threshold
4. **External** — supplied automatically: Indiana Similarity, a routed commute, or the
   city profile below

Which category gets the similarity score is decided by its `scoring_method = 'external'`
setting, not by its name, so you can rename or repoint it without touching code.

## Cities

Schools, safety and what's nearby are facts about a town, not about a house. Those
categories are marked `city_scoped` and rated once per town on the **Cities** page; every
property in that town inherits the rating. Typing a new city on a property adds that town
to the page automatically, so the two never drift apart.

Inherited ratings arrive as ordinary external scores, which means the precedence list
above already handles overriding them — anything typed on the property itself wins, down
to a single subcriterion. A property can also:

- **borrow another town's ratings** (`city_profile_id`), for an address that says one
  place while its schools and shops say another, or
- **opt out entirely** (`city_ratings_manual`) and be rated by hand.

The Cities page lists which properties are currently ignoring a town's ratings and offers
a one-click way to put them back on it. Any category can be switched between city-rated
and per-property in Tuning; nothing is keyed off the names *Schools*, *Safety* or
*Location* except the one-time migration of an older snapshot.

That migration lifts each town's existing ratings off its properties: the town takes the
value its properties agreed on, and a property whose own number differed keeps it as a
visible override rather than being averaged away.

## Indiana Similarity

Reused from `~/indiana-towns` rather than reimplemented. `npm run refresh-similarity`
re-copies `towns.json` / `meta.json` after you re-run that pipeline. The housing app
reads its own snapshot under `data/similarity/` so it keeps working if that project
moves or is mid-run.

Two things were adapted for house hunting:

**One-sided quality features.** The original metric is a true distance, so it is
symmetric — a town five times *safer* than Westfield was penalized as hard as one five
times more dangerous. That dropped Zionsville to the 65th percentile. For features where
more is unambiguously better for a family (safety, schools, income, affordability,
wages) the difference is clamped at zero when the town beats the reference. Character
features — population, distances, amenity counts — stay two-sided, because there the
goal really is to match Westfield's feel. Toggleable on the Tuning page.

**A percentile curve.** Raw similarity across the other 207 towns runs max 88 / median
39 / min 13, so reading those straight off a conventional grading table fails 93% of the
state. Instead a town is ranked against the observed distribution and the percentile is
mapped to a 0-100 app score. A+ starts at the most Westfield-like town in Indiana;
Westfield itself is 100. The Tuning page charts the resulting grade histogram and lets
you drag the anchors.

Direction is verified in the tests: higher always means more similar to the reference.

## Tuning

Dragging a category weight re-ranks every property instantly — the same engine runs in
the browser against already-loaded scores, no round trip. The header switches to
"Updated model" and each row shows its score delta and rank movement against the saved
model, so you can see what a change actually costs before committing it.

Also on that page: add/rename/remove categories, the letter-grade cutoffs, how Mark's
and Rachel's scores combine, the disagreement threshold, deal breakers, and the
similarity curve.

Deal breakers exclude a property from the rankings but keep it viewable, dimmed and
badged with the rule it broke.

## Weights

Category weights are typed in directly as percentages and should total 100 — the header
badge tells you when they don't. Subcriteria work identically inside their category:
percentages totalling 100, with an **Even split** button.

Neither total is enforced. The engine normalizes by whatever the enabled, scored rows
actually add up to, so an off-100 total still scores correctly; the warning exists
because a drifting total is nearly always an accident.

## Automatic scores (metrics)

A category or subcriterion either is scored by hand or points at a **metric** — a named
source that produces a 0-100 number:

- `similarity:westfield` — Westfield Similarity
- `commute:mark`, `commute:rachel` — drive time to each workplace

These are **not selectable in the UI**. The old "formula" and "hybrid" scoring methods
were removed because they were selectable but inert, and a picker that can silently
repoint a category at the wrong source is the same trap. Where a metric applies it's
shown read-only. Assign one with `PUT /api/categories/:id` or
`PUT /api/categories/subcriteria/:id` (`{"metric": "commute:mark"}`).

Anything entered by hand beats the computed value, so a metric can always be overruled
on one property. The scoring engine never sees these keys — the server resolves them to
numbers first, keeping the engine free of category-specific logic.

## Commute

`Location` holds two subcriteria — Mark's and Rachel's — each pointing at a commute
metric scored on **minutes of actual driving**.

Adding a property geocodes its address (Nominatim) and routes it to every destination
(OSRM), then caches the result in `commute_cache`. That's the only time the app touches
the network: scoring, ranking and tuning all read the cache, so day-to-day use works
offline. Changing an address clears and refetches; **Recalculate** on the property page
forces it.

Both services are free and keyless. If either is unreachable the commute is left
**unscored** rather than estimated — a missing number is more honest than a plausible
wrong one. Routes are also sanity-checked against straight-line distance, because a
coordinate the router can't place comes back as a valid-looking zero-length route, and
a 0-minute commute would otherwise score 100.

A street address is required for commute scoring. The app never substitutes a city- or
town-centre route; if the exact address cannot be located, commute remains unscored and
the property page asks you to check the address or recalculate.

Destinations live in Tuning → Commute with hand-entered coordinates. Add more for
family, church, or anywhere else you drive weekly — each one becomes a selectable
metric immediately.

## Subcriteria

Any category can be broken into weighted subcriteria (House / Apartment ships with
Layout, Space, Garage, Kitchen, Storage). Add them under a category's **Edit** panel on
Tuning. Once a category has subcriteria it scores as their weighted mean instead of one
direct number, and each subcriterion takes its own Mark and Rachel scores.

## Presets

Save the current weight set under a name — Balanced and Financial are seeded. Loading a
preset only fills the live preview; nothing is written until you hit **Save model**, so
you can try one on and back out. `⟳` overwrites a preset with the weights you're
currently previewing.

## Photos

Three places to add them: the **Add Property** form, the **Edit** form, and the property
page's Photos section. Drag or click; they're written to `data/photos/{property-id}/` as
ordinary files — no cloud, no base64 in the database.

On the Add form there's no property id yet, so files are held in memory (with previews)
and uploaded the instant the property is created. Otherwise you'd have to save, come
back, and re-find the photos you already had open.

The first photo becomes the listing's lead image on the Properties page.

## Data

`data/housing.db` is the local app's plain SQLite file. The GitHub Pages build uses the
committed JSON snapshot as its initial seed and persists shared changes through Cloudflare
D1. Browser storage is retained only as an offline fallback cache.

Tuning also has **Export**: properties CSV (facts, every category score and grade, the
overall, one row per property) and model JSON (categories, subcriteria, weights, grade
scale, deal breakers, presets, similarity curve).

## Theme

**Real Estate Editorial** — warm paper (`#faf7f2`), ink, and clay, defined as CSS custom
properties at the top of `frontend/src/styles.css`.

Fraunces (display serif) carries anything that means something — property names, grades,
scores, weights. Inter handles UI text. Both are bundled locally via `@fontsource-variable`,
so the app still makes no external requests for assets.

The design deliberately avoids pills and boxes: a "badge" is small-caps type with a
hairline under it, listings are a ruled grid rather than floating cards, and the main
Tuning column sits directly on the paper (`.card.plain`). Boxes are reserved for the
sidebar panels.
