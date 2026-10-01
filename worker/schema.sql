-- nett-db (Cloudflare D1). One row per ledger event + one settings row.
CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  data        TEXT NOT NULL,          -- full event JSON
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_updated ON events(updated_at);
CREATE TABLE IF NOT EXISTS kv (
  k           TEXT PRIMARY KEY,
  data        TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
