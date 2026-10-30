import { badRequest, notFound } from '../errors.js';
import { runInTransaction } from '../db/database.js';
import { recordAudit } from './auditService.js';
import { defaultTournamentConfig, TIE_BREAKER_KEYS } from './defaultTournamentConfig.js';
import { optionalText, requireBoolean, requireInteger, requireObject, requireText } from '../validation.js';

// The application supports a single active event: the first one in the table.
export function getActiveEvent(db) {
  const row = db.prepare('SELECT * FROM events ORDER BY id LIMIT 1').get();
  if (!row) throw notFound('No event exists. Run the database migration.');
  return { id: row.id, name: row.name, clubName: row.club_name, status: row.status };
}

export function updateEvent(db, input) {
  const body = requireObject(input);
  const event = getActiveEvent(db);
  const name = body.name === undefined ? event.name : requireText(body.name, 'name', { max: 100 });
  const clubName = body.clubName === undefined ? event.clubName : requireText(body.clubName, 'clubName', { max: 100 });
  const status = body.status === undefined ? event.status : body.status;
  if (!['setup', 'live', 'completed'].includes(status)) {
    throw badRequest('status must be one of: setup, live, completed');
  }
  runInTransaction(db, () => {
    db.prepare("UPDATE events SET name = ?, club_name = ?, status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
      .run(name, clubName, status, event.id);
    recordAudit(db, event.id, 'event.update', 'event', event.id, { name, clubName, status });
  });
  return getActiveEvent(db);
}

export function getTournamentConfig(db, eventId) {
  const row = db.prepare('SELECT config_json FROM event_config WHERE event_id = ?').get(eventId);
  if (!row) throw notFound('Event configuration is missing');
  // Saved configurations from older versions may lack newer keys; fill those from the defaults.
  const saved = JSON.parse(row.config_json);
  const display = { ...defaultTournamentConfig.display, ...saved.display };
  delete display.scrollPageSize; // replaced by teamsPerPage
  return {
    ...saved,
    scoring: { ...defaultTournamentConfig.scoring, ...saved.scoring },
    scheduledLeaderboard: { ...defaultTournamentConfig.scheduledLeaderboard, ...saved.scheduledLeaderboard },
    display,
  };
}

export function updateTournamentConfig(db, eventId, input) {
  const config = validateTournamentConfig(input);
  runInTransaction(db, () => {
    db.prepare(
      "UPDATE event_config SET config_json = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE event_id = ?",
    ).run(JSON.stringify(config), eventId);
    recordAudit(db, eventId, 'config.update', 'event_config', eventId, { scoring: config.scoring });
  });
  return config;
}

// Validates and normalizes a full configuration object. Unknown keys are dropped.
export function validateTournamentConfig(input) {
  const body = requireObject(input, 'config');
  const scoring = requireObject(body.scoring, 'config.scoring');
  const roster = requireObject(body.roster, 'config.roster');
  const branding = requireObject(body.branding, 'config.branding');
  const display = requireObject(body.display, 'config.display');

  return {
    scoring: {
      finishPointsPerElimination: requireInteger(scoring.finishPointsPerElimination, 'finishPointsPerElimination', { min: 0, max: 100 }),
      placementPoints: validatePlacementPointsTable(scoring.placementPoints),
      winnerPlacement: requireInteger(scoring.winnerPlacement, 'winnerPlacement', { min: 1, max: 100 }),
      tieBreakers: validateTieBreakers(scoring.tieBreakers),
      allowDuplicatePlacements: requireBoolean(scoring.allowDuplicatePlacements, 'allowDuplicatePlacements'),
      maxFinishesPerMatch: requireInteger(scoring.maxFinishesPerMatch, 'maxFinishesPerMatch', { min: 1, max: 1000 }),
      // Added later: older saved configurations and backups do not have it yet.
      requirePlayerReconciliationToFinalize: requireBoolean(
        scoring.requirePlayerReconciliationToFinalize ?? defaultTournamentConfig.scoring.requirePlayerReconciliationToFinalize,
        'requirePlayerReconciliationToFinalize',
      ),
      requireAllTeamsPlaced: requireBoolean(scoring.requireAllTeamsPlaced, 'requireAllTeamsPlaced'),
      countInProgressMatchInStandings: requireBoolean(scoring.countInProgressMatchInStandings, 'countInProgressMatchInStandings'),
    },
    roster: {
      playersPerTeam: requireInteger(roster.playersPerTeam, 'playersPerTeam', { min: 1, max: 10 }),
    },
    branding: {
      tagline: optionalText(branding.tagline, 'tagline', { max: 120 }) ?? '',
    },
    scheduledLeaderboard: validateScheduledLeaderboard(body.scheduledLeaderboard),
    display: {
      ambientVideoFile: validateMediaFileName(display.ambientVideoFile),
      // teamsPerPage / rotatePagesWhileVisible were added later (older configs had scrollPageSize,
      // which is ignored): fall back to the defaults when they are missing.
      teamsPerPage: requireInteger(display.teamsPerPage ?? defaultTournamentConfig.display.teamsPerPage, 'teamsPerPage', { min: 1, max: 50 }),
      rotatePagesWhileVisible: requireBoolean(
        display.rotatePagesWhileVisible ?? defaultTournamentConfig.display.rotatePagesWhileVisible,
        'rotatePagesWhileVisible',
      ),
      defaultScrollIntervalSeconds: requireInteger(display.defaultScrollIntervalSeconds, 'defaultScrollIntervalSeconds', { min: 3, max: 120 }),
      topFraggersCount: requireInteger(display.topFraggersCount, 'topFraggersCount', { min: 1, max: 20 }),
    },
  };
}

// Added later: configurations and backups from older versions have no such block, so a missing
// block (or key) falls back to the defaults.
function validateScheduledLeaderboard(input) {
  const defaults = defaultTournamentConfig.scheduledLeaderboard;
  const source = input === undefined ? {} : requireObject(input, 'config.scheduledLeaderboard');
  const settings = {
    enabled: requireBoolean(source.enabled ?? defaults.enabled, 'scheduledLeaderboard.enabled'),
    leaderboardIntervalMs: requireInteger(source.leaderboardIntervalMs ?? defaults.leaderboardIntervalMs, 'leaderboardIntervalMs', { min: 5000, max: 86400000 }),
    leaderboardDisplayDurationMs: requireInteger(source.leaderboardDisplayDurationMs ?? defaults.leaderboardDisplayDurationMs, 'leaderboardDisplayDurationMs', { min: 1000, max: 600000 }),
    teamsPerPage: requireInteger(source.teamsPerPage ?? defaults.teamsPerPage, 'scheduledLeaderboard.teamsPerPage', { min: 1, max: 50 }),
  };
  if (settings.leaderboardDisplayDurationMs >= settings.leaderboardIntervalMs) {
    throw badRequest('leaderboardDisplayDurationMs must be shorter than leaderboardIntervalMs');
  }
  return settings;
}

function validatePlacementPointsTable(table) {
  const source = requireObject(table, 'placementPoints');
  const normalized = {};
  for (const [placementKey, points] of Object.entries(source)) {
    if (!/^[1-9][0-9]{0,2}$/.test(placementKey)) {
      throw badRequest(`placementPoints key "${placementKey}" must be a placement number such as 1`);
    }
    normalized[placementKey] = requireInteger(points, `placementPoints[${placementKey}]`, { min: 0, max: 1000 });
  }
  return normalized;
}

function validateTieBreakers(tieBreakers) {
  if (!Array.isArray(tieBreakers)) throw badRequest('tieBreakers must be a list');
  const unknown = tieBreakers.filter((key) => !TIE_BREAKER_KEYS.includes(key));
  if (unknown.length > 0) {
    throw badRequest(`Unknown tie-breakers: ${unknown.join(', ')}. Allowed: ${TIE_BREAKER_KEYS.join(', ')}`);
  }
  if (new Set(tieBreakers).size !== tieBreakers.length) throw badRequest('tieBreakers must not repeat a key');
  return tieBreakers;
}

// A bare file name keeps the video inside the media folder (no path traversal).
function validateMediaFileName(fileName) {
  const text = requireText(fileName, 'ambientVideoFile', { max: 100 });
  if (!/^[A-Za-z0-9._-]+$/.test(text) || text.startsWith('.')) {
    throw badRequest('ambientVideoFile must be a plain file name such as ambient.mp4');
  }
  return text;
}
