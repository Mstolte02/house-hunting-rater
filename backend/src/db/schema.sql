-- Housing rater local schema. One SQLite file under data/housing.db.
-- Everything is local: no auth, no remote database, nothing leaves the machine.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS properties (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  address         TEXT,
  city            TEXT,
  state           TEXT DEFAULT 'IN',
  zip             TEXT,
  url             TEXT,
  property_type   TEXT NOT NULL DEFAULT 'House',
  status          TEXT NOT NULL DEFAULT 'Considering',

  monthly_cost    REAL,
  hoa             REAL,
  property_taxes  REAL,
  insurance       REAL,
  utilities       REAL,
  deposit         REAL,
  move_in_costs   REAL,

  bedrooms        REAL,
  bathrooms       REAL,
  square_feet     REAL,
  lot_size        REAL,
  year_built      INTEGER,
  garage_spaces   REAL,
  parking         TEXT,

  latitude        REAL,
  longitude       REAL,
  -- Town matched into the Indiana Similarity dataset. Null = fall back to `city`.
  similarity_town TEXT,

  notes           TEXT,
  pros            TEXT,
  cons            TEXT,
  visit_notes     TEXT,

  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL UNIQUE,
  description    TEXT,
  weight         REAL NOT NULL DEFAULT 10,
  enabled        INTEGER NOT NULL DEFAULT 1,
  scoring_method TEXT NOT NULL DEFAULT 'manual',
  -- Names an automatic score source ('similarity:westfield', 'commute:mark').
  -- NULL means the category is scored by hand.
  metric         TEXT,
  -- 1 when Mark and Rachel agree on one number instead of rating separately.
  single_score   INTEGER NOT NULL DEFAULT 0,
  sort_order     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS subcriteria (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  weight      REAL NOT NULL DEFAULT 1,
  enabled     INTEGER NOT NULL DEFAULT 1,
  metric      TEXT
);

CREATE TABLE IF NOT EXISTS property_scores (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id     INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  category_id     INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  score           REAL,
  mark_score      REAL,
  rachel_score    REAL,
  override_score  REAL,
  override_reason TEXT,
  notes           TEXT,
  UNIQUE (property_id, category_id)
);

CREATE TABLE IF NOT EXISTS subcriteria_scores (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id     INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  subcriterion_id INTEGER NOT NULL REFERENCES subcriteria(id) ON DELETE CASCADE,
  score           REAL,
  mark_score      REAL,
  rachel_score    REAL,
  UNIQUE (property_id, subcriterion_id)
);

CREATE TABLE IF NOT EXISTS model_presets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS model_preset_weights (
  preset_id   INTEGER NOT NULL REFERENCES model_presets(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  weight      REAL NOT NULL,
  PRIMARY KEY (preset_id, category_id)
);

CREATE TABLE IF NOT EXISTS deal_breakers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  label      TEXT NOT NULL,
  field      TEXT NOT NULL,
  comparator TEXT NOT NULL DEFAULT 'max',   -- 'max' = fail when above, 'min' = fail when below
  value      REAL NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 0
);

-- Routed drive times, fetched once per property/destination and reused forever after.
-- This is what keeps the app offline in normal use: only adding a property or changing
-- its address goes to the network.
CREATE TABLE IF NOT EXISTS commute_cache (
  property_id  INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  destination  TEXT NOT NULL,
  minutes      REAL NOT NULL,
  miles        REAL NOT NULL,
  -- 'address' when routed from the property's own coordinates, 'town' when we could
  -- only place it at the centre of its town.
  origin       TEXT NOT NULL DEFAULT 'town',
  origin_label TEXT,
  fetched_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (property_id, destination)
);

-- Single-row-per-key store for tunables: grade scale, curve anchors, rater combine mode.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scores_property ON property_scores(property_id);
CREATE INDEX IF NOT EXISTS idx_subscores_property ON subcriteria_scores(property_id);
