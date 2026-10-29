// JSON backup export and restore.
// Restore REPLACES all tournament data. The backup is fully validated first; the replacement
// then runs in one transaction, so a failure leaves the existing data untouched.
import { runInTransaction } from '../db/database.js';
import { BACKFILL_TEAM_FINISHES_SQL } from '../db/migrate.js';
import { unprocessable } from '../errors.js';
import { recordAudit } from './auditService.js';
import { validateTournamentConfig } from './eventService.js';

export const BACKUP_FORMAT = 'bgmi-tournament-backup';
// Version 2 stores team finish totals in team_match_results. Version 1 backups (team totals
// were derived from finish_events) are still accepted and converted while restoring.
export const BACKUP_VERSION = 2;
const READABLE_VERSIONS = [1, 2];

// Column types: int, text, intOrNull, textOrNull, intDefault0 (missing in older backups).
// Tables are listed in insert order (parents before children); deletion runs in reverse.
const BACKUP_TABLES = [
  { name: 'events', columns: { id: 'int', name: 'text', club_name: 'text', status: 'text', created_at: 'text', updated_at: 'text' } },
  { name: 'event_config', columns: { event_id: 'int', config_json: 'text', updated_at: 'text' } },
  { name: 'teams', columns: { id: 'int', event_id: 'int', name: 'text', short_name: 'textOrNull', logo_path: 'textOrNull', active: 'int', created_at: 'text' } },
  { name: 'players', columns: { id: 'int', team_id: 'int', name: 'text', in_game_name: 'textOrNull', active: 'int', created_at: 'text' } },
  { name: 'matches', columns: { id: 'int', event_id: 'int', match_number: 'int', label: 'textOrNull', status: 'text', created_at: 'text', finalized_at: 'textOrNull' } },
  { name: 'team_match_results', columns: { id: 'int', match_id: 'int', team_id: 'int', placement: 'intOrNull', placement_points: 'int', is_wwcd: 'int', finish_points_snapshot: 'intOrNull', finish_count: 'intDefault0', finish_entered: 'intDefault0' } },
  { name: 'finish_events', columns: { id: 'int', event_id: 'int', match_id: 'int', team_id: 'int', player_id: 'intOrNull', action_type: 'text', idempotency_key: 'textOrNull', created_at: 'text', reversed_at: 'textOrNull' } },
  { name: 'broadcast_state', columns: { id: 'int', event_id: 'int', mode: 'text', leaderboard_layout: 'text', current_match_id: 'intOrNull', scroll_interval_seconds: 'int', mvp_player_id: 'intOrNull', headline_text: 'textOrNull', subtitle_text: 'textOrNull', updated_at: 'text' } },
  { name: 'audit_log', columns: { id: 'int', event_id: 'intOrNull', action: 'text', entity_type: 'text', entity_id: 'intOrNull', details_json: 'text', created_at: 'text' } },
];

const ALLOWED_VALUES = {
  'events.status': ['setup', 'live', 'completed'],
  'matches.status': ['planned', 'in_progress', 'finalized'],
  'broadcast_state.mode': ['ambient', 'standings', 'mvp'],
  'broadcast_state.leaderboard_layout': ['full', 'scrolling'],
  'finish_events.action_type': ['finish'],
  'teams.active': [0, 1],
  'players.active': [0, 1],
  'team_match_results.is_wwcd': [0, 1],
  'team_match_results.finish_entered': [0, 1],
};

const MAX_REPORTED_PROBLEMS = 25;

export function exportBackup(db) {
  const tables = {};
  for (const table of BACKUP_TABLES) {
    const columnNames = Object.keys(table.columns).join(', ');
    tables[table.name] = db.prepare(`SELECT ${columnNames} FROM ${table.name} ORDER BY ${firstColumn(table)}`).all()
      .map((row) => ({ ...row }));
  }
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), tables };
}

function firstColumn(table) {
  return Object.keys(table.columns)[0];
}

function defaultFor(type) {
  if (type.endsWith('OrNull')) return null;
  return type === 'intDefault0' ? 0 : undefined;
}

function isValidValue(value, type) {
  if (type.endsWith('OrNull') && value === null) return true;
  return type.startsWith('int') ? Number.isInteger(value) : typeof value === 'string';
}

// Returns a list of human-readable problems; an empty list means the backup is safe to restore.
export function validateBackup(backup) {
  const problems = [];
  const report = (message) => {
    if (problems.length < MAX_REPORTED_PROBLEMS) problems.push(message);
  };

  if (backup === null || typeof backup !== 'object' || backup.format !== BACKUP_FORMAT) {
    return [`Not a tournament backup file (expected format "${BACKUP_FORMAT}").`];
  }
  if (!READABLE_VERSIONS.includes(backup.version)) {
    return [`Unsupported backup version ${backup.version}; this server reads versions ${READABLE_VERSIONS.join(' and ')}.`];
  }
  if (backup.tables === null || typeof backup.tables !== 'object') {
    return ['The backup has no "tables" section.'];
  }

  const idsByTable = {};
  for (const table of BACKUP_TABLES) {
    const rows = backup.tables[table.name];
    if (!Array.isArray(rows)) {
      report(`Table "${table.name}" is missing or not a list.`);
      continue;
    }
    const ids = new Set();
    rows.forEach((row, index) => {
      const label = `${table.name}[${index}]`;
      if (row === null || typeof row !== 'object') return report(`${label} is not an object.`);
      for (const [column, type] of Object.entries(table.columns)) {
        const value = row[column] === undefined ? defaultFor(type) : row[column];
        if (!isValidValue(value, type)) report(`${label}.${column} has an invalid value.`);
        if (column === 'finish_count' && value < 0) report(`${label}.${column} must not be negative.`);
        const allowed = ALLOWED_VALUES[`${table.name}.${column}`];
        if (allowed && !allowed.includes(value)) report(`${label}.${column} must be one of: ${allowed.join(', ')}.`);
      }
      if (table.columns.id !== undefined) {
        if (ids.has(row.id)) report(`${label} repeats id ${row.id}.`);
        ids.add(row.id);
      }
    });
    idsByTable[table.name] = ids;
  }
  if (problems.length > 0) return problems;

  const { tables } = backup;
  const checkReference = (tableName, column, targetTable, { nullable = false } = {}) => {
    tables[tableName].forEach((row, index) => {
      if (row[column] == null) {
        if (!nullable) report(`${tableName}[${index}].${column} is required.`);
      } else if (!idsByTable[targetTable].has(row[column])) {
        report(`${tableName}[${index}].${column} points to a ${targetTable} row that does not exist.`);
      }
    });
  };
  checkReference('event_config', 'event_id', 'events');
  checkReference('teams', 'event_id', 'events');
  checkReference('players', 'team_id', 'teams');
  checkReference('matches', 'event_id', 'events');
  checkReference('team_match_results', 'match_id', 'matches');
  checkReference('team_match_results', 'team_id', 'teams');
  checkReference('finish_events', 'event_id', 'events');
  checkReference('finish_events', 'match_id', 'matches');
  checkReference('finish_events', 'team_id', 'teams');
  checkReference('finish_events', 'player_id', 'players', { nullable: true });
  checkReference('broadcast_state', 'event_id', 'events');
  checkReference('broadcast_state', 'current_match_id', 'matches', { nullable: true });
  checkReference('broadcast_state', 'mvp_player_id', 'players', { nullable: true });
  checkReference('audit_log', 'event_id', 'events', { nullable: true });

  if (tables.events.length !== 1) report('The backup must contain exactly one event.');
  if (tables.event_config.length !== 1) report('The backup must contain exactly one event configuration.');
  if (tables.broadcast_state.length !== 1 || tables.broadcast_state[0]?.id !== 1) {
    report('The backup must contain exactly one broadcast state with id 1.');
  }

  reportDuplicates(tables.teams, ['event_id', 'name'], 'teams', report);
  reportDuplicates(tables.matches, ['event_id', 'match_number'], 'matches', report);
  reportDuplicates(tables.team_match_results, ['match_id', 'team_id'], 'team_match_results', report);
  reportDuplicates(tables.finish_events.filter((row) => row.idempotency_key != null), ['idempotency_key'], 'finish_events', report);

  if (tables.event_config.length === 1) {
    try {
      validateTournamentConfig(JSON.parse(tables.event_config[0].config_json));
    } catch (error) {
      report(`Event configuration is invalid: ${error.message}`);
    }
  }
  return problems;
}

function reportDuplicates(rows, keyColumns, tableName, report) {
  const seen = new Set();
  for (const row of rows) {
    const key = JSON.stringify(keyColumns.map((column) => row[column]));
    if (seen.has(key)) report(`${tableName} contains a duplicate (${keyColumns.join(', ')}) = ${key}.`);
    seen.add(key);
  }
}

export function restoreBackup(db, backup) {
  const problems = validateBackup(backup);
  if (problems.length > 0) {
    throw unprocessable('The backup file is not valid. Nothing was changed.', problems);
  }

  return runInTransaction(db, () => {
    for (const table of [...BACKUP_TABLES].reverse()) {
      db.exec(`DELETE FROM ${table.name}`);
    }
    db.exec('DELETE FROM score_requests'); // request ids belong to the replaced data
    for (const table of BACKUP_TABLES) {
      const columnNames = Object.keys(table.columns);
      const insert = db.prepare(
        `INSERT INTO ${table.name} (${columnNames.join(', ')}) VALUES (${columnNames.map(() => '?').join(', ')})`,
      );
      for (const row of backup.tables[table.name]) {
        insert.run(...columnNames.map((column) => row[column] ?? defaultFor(table.columns[column]) ?? null));
      }
    }
    if (backup.version === 1) db.exec(BACKFILL_TEAM_FINISHES_SQL);
    const eventId = backup.tables.events[0].id;
    recordAudit(db, eventId, 'backup.restore', 'backup', null, {
      exportedAt: backup.exportedAt ?? null,
      counts: Object.fromEntries(BACKUP_TABLES.map((table) => [table.name, backup.tables[table.name].length])),
    });
    return { restored: Object.fromEntries(BACKUP_TABLES.map((table) => [table.name, backup.tables[table.name].length])) };
  });
}
