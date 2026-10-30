PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE provider_identities (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'github')),
  provider_subject TEXT NOT NULL,
  email TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0
    CHECK (email_verified IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (provider, provider_subject)
);

CREATE INDEX provider_identities_user_id_idx
  ON provider_identities (user_id);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX sessions_user_id_expires_at_idx
  ON sessions (user_id, expires_at);

CREATE TABLE matches (
  id TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('created', 'in_progress', 'completed', 'abandoned', 'cancelled')),
  winner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX matches_status_created_at_idx
  ON matches (status, created_at);

CREATE TABLE match_players (
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  seat INTEGER NOT NULL CHECK (seat IN (1, 2)),
  rounds_won INTEGER NOT NULL DEFAULT 0 CHECK (rounds_won >= 0),
  character_id TEXT,
  PRIMARY KEY (match_id, user_id),
  UNIQUE (match_id, seat)
);

CREATE INDEX match_players_user_id_idx
  ON match_players (user_id);

CREATE TABLE player_stats (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  matches_played INTEGER NOT NULL DEFAULT 0 CHECK (matches_played >= 0),
  matches_won INTEGER NOT NULL DEFAULT 0 CHECK (matches_won >= 0),
  matches_lost INTEGER NOT NULL DEFAULT 0 CHECK (matches_lost >= 0),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
