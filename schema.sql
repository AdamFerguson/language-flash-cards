CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  label TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS progress (
  user_id INTEGER NOT NULL,
  lang TEXT NOT NULL,
  card_id TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'learning',   -- learning | young | mature
  ease REAL NOT NULL DEFAULT 2.5,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  interval REAL NOT NULL DEFAULT 0,          -- days (0 = relearn step)
  due TEXT NOT NULL,                          -- ISO datetime
  last_seen TEXT,
  PRIMARY KEY (user_id, lang, card_id)
);

CREATE INDEX IF NOT EXISTS idx_progress_due ON progress (user_id, lang, due);

CREATE TABLE IF NOT EXISTS studied (
  user_id INTEGER NOT NULL,
  lang TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  studied_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, lang, unit_id)
);

CREATE TABLE IF NOT EXISTS quizzes (
  user_id INTEGER NOT NULL,
  lang TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  score REAL NOT NULL,
  passed INTEGER NOT NULL,
  taken_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity (
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,                          -- YYYY-MM-DD
  xp INTEGER NOT NULL DEFAULT 0,
  reviews INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS logins (
  ts TEXT DEFAULT (datetime('now')),
  ok INTEGER NOT NULL,
  who TEXT,
  ip TEXT,
  country TEXT,
  ua TEXT
);

INSERT OR IGNORE INTO users (id, label) VALUES (1, 'primary');
