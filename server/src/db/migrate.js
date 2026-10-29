// Schema migrations. Each migration runs once, in order, inside a transaction.
// To change the schema later, append a new entry; never edit an applied one.
import { fileURLToPath } from 'node:url';
import { loadServerConfig } from '../config.js';
import { openDatabase, runInTransaction } from './database.js';
import { defaultTournamentConfig } from '../services/defaultTournamentConfig.js';

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

// Before migration 2 a team's finish total was the number of unreversed rows in finish_events.
// This copies those totals into team_match_results so existing standings do not change.
// Also used when restoring a version 1 backup.
export const BACKFILL_TEAM_FINISHES_SQL = `
  INSERT INTO team_match_results (match_id, team_id, finish_count, finish_entered)
  SELECT match_id, team_id, COUNT(*), 1 FROM finish_events WHERE reversed_at IS NULL GROUP BY match_id, team_id
  ON CONFLICT (match_id, team_id) DO UPDATE SET finish_count = excluded.finish_count, finish_entered = 1`;

const migrations = [
  {
    version: 1,
    name: 'initial schema',
    sql: `
      CREATE TABLE events (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        club_name TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ('setup', 'live', 'completed')),
        created_at TEXT NOT NULL DEFAULT (${NOW}),
        updated_at TEXT NOT NULL DEFAULT (${NOW})
      );

      CREATE TABLE event_config (
        event_id INTEGER PRIMARY KEY REFERENCES events(id),
        config_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (${NOW})
      );

      CREATE TABLE teams (
        id INTEGER PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES events(id),
        name TEXT NOT NULL,
        short_name TEXT,
        logo_path TEXT,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT (${NOW}),
        UNIQUE (event_id, name)
      );

      CREATE TABLE players (
        id INTEGER PRIMARY KEY,
        team_id INTEGER NOT NULL REFERENCES teams(id),
        name TEXT NOT NULL,
        in_game_name TEXT,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT (${NOW})
      );
      CREATE INDEX idx_players_team ON players(team_id);

      CREATE TABLE matches (
        id INTEGER PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES events(id),
        match_number INTEGER NOT NULL CHECK (match_number >= 1),
        label TEXT,
        status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'finalized')),
        created_at TEXT NOT NULL DEFAULT (${NOW}),
        finalized_at TEXT,
        UNIQUE (event_id, match_number)
      );

      -- One row per team per match. The *_snapshot and points columns are frozen when the
      -- match is finalized so later rule changes cannot silently rewrite history.
      CREATE TABLE team_match_results (
        id INTEGER PRIMARY KEY,
        match_id INTEGER NOT NULL REFERENCES matches(id),
        team_id INTEGER NOT NULL REFERENCES teams(id),
        placement INTEGER CHECK (placement IS NULL OR placement >= 1),
        placement_points INTEGER NOT NULL DEFAULT 0,
        is_wwcd INTEGER NOT NULL DEFAULT 0 CHECK (is_wwcd IN (0, 1)),
        finish_points_snapshot INTEGER,
        UNIQUE (match_id, team_id)
      );

      -- Ledger of individual finishes. This is the single source of truth for finish counts.
      -- team_id is recorded at the time of the finish so roster edits never rewrite history.
      -- player_id is NULL only for explicitly allowed unattributed finishes.
      -- Reversals set reversed_at; rows are never deleted.
      CREATE TABLE finish_events (
        id INTEGER PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES events(id),
        match_id INTEGER NOT NULL REFERENCES matches(id),
        team_id INTEGER NOT NULL REFERENCES teams(id),
        player_id INTEGER REFERENCES players(id),
        action_type TEXT NOT NULL DEFAULT 'finish' CHECK (action_type IN ('finish')),
        idempotency_key TEXT UNIQUE,
        created_at TEXT NOT NULL DEFAULT (${NOW}),
        reversed_at TEXT
      );
      CREATE INDEX idx_finish_events_match ON finish_events(match_id);

      -- Per-match player statistics, derived from the ledger so the two can never disagree.
      CREATE VIEW player_match_stats AS
        SELECT match_id, player_id, team_id, COUNT(*) AS finish_count
        FROM finish_events
        WHERE reversed_at IS NULL AND player_id IS NOT NULL
        GROUP BY match_id, player_id, team_id;

      CREATE TABLE broadcast_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        event_id INTEGER NOT NULL REFERENCES events(id),
        mode TEXT NOT NULL DEFAULT 'ambient' CHECK (mode IN ('ambient', 'standings', 'mvp')),
        leaderboard_layout TEXT NOT NULL DEFAULT 'full' CHECK (leaderboard_layout IN ('full', 'scrolling')),
        current_match_id INTEGER REFERENCES matches(id),
        scroll_interval_seconds INTEGER NOT NULL DEFAULT 8 CHECK (scroll_interval_seconds BETWEEN 3 AND 120),
        mvp_player_id INTEGER REFERENCES players(id),
        headline_text TEXT,
        subtitle_text TEXT,
        updated_at TEXT NOT NULL DEFAULT (${NOW})
      );

      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY,
        event_id INTEGER REFERENCES events(id),
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id INTEGER,
        details_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (${NOW})
      );
    `,
  },
  {
    version: 2,
    name: 'stored team finish totals and score request ids',
    sql: `
      ALTER TABLE team_match_results ADD COLUMN finish_count INTEGER NOT NULL DEFAULT 0 CHECK (finish_count >= 0);
      ALTER TABLE team_match_results ADD COLUMN finish_entered INTEGER NOT NULL DEFAULT 0 CHECK (finish_entered IN (0, 1));

      ${BACKFILL_TEAM_FINISHES_SQL};

      -- Remembers every processed +/- request so a retry or double submit changes nothing twice.
      CREATE TABLE score_requests (
        request_id TEXT PRIMARY KEY,
        signature TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (${NOW})
      );
    `,
  },
];

export function migrate(db, { targetVersion = Infinity } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (${NOW})
  )`);

  const appliedVersions = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((row) => row.version),
  );
  const appliedNow = [];
  for (const migration of migrations) {
    if (appliedVersions.has(migration.version) || migration.version > targetVersion) continue;
    runInTransaction(db, () => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(migration.version, migration.name);
    });
    appliedNow.push(migration.version);
  }
  ensureDefaultEvent(db);
  return appliedNow;
}

// The app supports one active event. Create it on a fresh database so the UI always has one.
function ensureDefaultEvent(db) {
  const existing = db.prepare('SELECT id FROM events ORDER BY id LIMIT 1').get();
  if (existing) return;
  runInTransaction(db, () => {
    // TODO: CONFIGURE HERE - default event and club names (also editable in the Settings tab).
    const { lastInsertRowid } = db
      .prepare('INSERT INTO events (name, club_name) VALUES (?, ?)')
      .run('College BGMI Tournament', 'Organizing Club');
    const eventId = Number(lastInsertRowid);
    db.prepare('INSERT INTO event_config (event_id, config_json) VALUES (?, ?)').run(
      eventId,
      JSON.stringify(defaultTournamentConfig),
    );
    db.prepare('INSERT INTO broadcast_state (id, event_id, scroll_interval_seconds) VALUES (1, ?, ?)').run(
      eventId,
      defaultTournamentConfig.display.defaultScrollIntervalSeconds,
    );
  });
}

// `npm run db:migrate`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = loadServerConfig();
  const db = openDatabase(config.databasePath);
  const applied = migrate(db);
  console.log(
    applied.length
      ? `Applied migrations: ${applied.join(', ')} -> ${config.databasePath}`
      : `Database already up to date: ${config.databasePath}`,
  );
  db.close();
}
