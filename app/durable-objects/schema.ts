export const ROOM_SCHEMA = `
CREATE TABLE IF NOT EXISTS room_metadata (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  room_id TEXT NOT NULL,
  name TEXT NOT NULL,
  owner_user_id TEXT,
  persistent INTEGER NOT NULL,
  invite_hash TEXT,
  created_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS seats (
  player_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  reconnect_hash TEXT NOT NULL UNIQUE,
  user_id TEXT,
  seat_index INTEGER NOT NULL UNIQUE,
  connected INTEGER NOT NULL DEFAULT 0,
  joined_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS game_snapshot (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS processed_actions (
  action_id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  room_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS completed_matches (
  id TEXT PRIMARY KEY,
  winner_player_id TEXT NOT NULL,
  completed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS standings (
  display_name TEXT PRIMARY KEY,
  games INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
`;
