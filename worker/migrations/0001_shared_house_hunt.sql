CREATE TABLE IF NOT EXISTS house_hunt_state (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL CHECK (json_valid(data)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS house_hunt_config (
  id TEXT PRIMARY KEY,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_iterations INTEGER NOT NULL CHECK (password_iterations >= 100000),
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS house_hunt_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS house_hunt_login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash TEXT NOT NULL,
  attempted_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS house_hunt_sessions_expires_at_idx
  ON house_hunt_sessions (expires_at);
CREATE INDEX IF NOT EXISTS house_hunt_login_attempts_ip_time_idx
  ON house_hunt_login_attempts (ip_hash, attempted_at DESC);
