// Elimination events: "Team A was eliminated by Team B" (optionally credited to one player).
//
// This is a broadcast and audit record ONLY. Nothing here touches team finishes, player
// finishes, kills or points; those stay in team_match_results and the finish_events ledger.
// If the operator also records a finish, that is a separate action and is counted once, there.
//
// Events are never deleted. A mistaken event is voided (status 'voided') and stays in history.
import { runInTransaction } from '../db/database.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { recordAudit } from './auditService.js';
import { getMatch, requireActiveTeam, requireInProgress, runIdempotent } from './matchRecords.js';
import { optionalText, requireInteger, requireObject, requireText } from '../validation.js';

const MAX_METADATA_CHARS = 2000;

function toTeamInfo(row, prefix) {
  return {
    id: row[`${prefix}_id`],
    name: row[`${prefix}_name`],
    shortName: row[`${prefix}_short_name`],
    logoPath: row[`${prefix}_logo_path`],
  };
}

const SELECT_ELIMINATION = `
  SELECT e.*, m.match_number,
         et.id AS elim_id, et.name AS elim_name, et.short_name AS elim_short_name, et.logo_path AS elim_logo_path,
         ct.id AS cred_id, ct.name AS cred_name, ct.short_name AS cred_short_name, ct.logo_path AS cred_logo_path,
         p.name AS player_name, p.in_game_name AS player_in_game_name
  FROM elimination_events e
  JOIN matches m ON m.id = e.match_id
  JOIN teams et ON et.id = e.eliminated_team_id
  JOIN teams ct ON ct.id = e.credited_team_id
  LEFT JOIN players p ON p.id = e.credited_player_id`;

function toEliminationDto(row) {
  return {
    id: row.id,
    matchId: row.match_id,
    matchNumber: row.match_number,
    status: row.status,
    eliminatedTeamId: row.eliminated_team_id,
    creditedTeamId: row.credited_team_id,
    creditedPlayerId: row.credited_player_id,
    eliminatedTeam: toTeamInfo(row, 'elim'),
    creditedTeam: toTeamInfo(row, 'cred'),
    creditedPlayer: row.credited_player_id === null
      ? null
      : { id: row.credited_player_id, name: row.player_name, inGameName: row.player_in_game_name },
    recordedBy: row.recorded_by,
    metadata: JSON.parse(row.metadata_json),
    createdAt: row.created_at,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
  };
}

export function getEliminationEvent(db, eliminationId) {
  const row = db.prepare(`${SELECT_ELIMINATION} WHERE e.id = ?`).get(eliminationId);
  if (!row) throw notFound(`Elimination event ${eliminationId} does not exist`);
  return toEliminationDto(row);
}

// Full history of a match, oldest first, including voided events.
export function listEliminations(db, matchId) {
  getMatch(db, matchId); // 404 for an unknown match
  return db
    .prepare(`${SELECT_ELIMINATION} WHERE e.match_id = ? ORDER BY e.id`)
    .all(matchId)
    .map(toEliminationDto);
}

function readOptionalId(value, field) {
  return value === undefined || value === null ? null : requireInteger(value, field, { min: 1 });
}

function readMetadata(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw badRequest('metadata must be a JSON object');
  if (JSON.stringify(value).length > MAX_METADATA_CHARS) {
    throw badRequest(`metadata must be at most ${MAX_METADATA_CHARS} characters of JSON`);
  }
  return value;
}

// Body: { eliminatedTeamId, creditedTeamId, creditedPlayerId?, requestId, metadata? }.
// Returns { elimination, duplicate }. A repeated requestId returns the first result with
// duplicate: true and creates nothing; the caller must not broadcast a duplicate again.
export function recordElimination(db, matchId, input, { operator = null } = {}) {
  const body = requireObject(input);
  const eliminatedTeamId = requireInteger(body.eliminatedTeamId, 'eliminatedTeamId', { min: 1 });
  const creditedTeamId = requireInteger(body.creditedTeamId, 'creditedTeamId', { min: 1 });
  const creditedPlayerId = readOptionalId(body.creditedPlayerId, 'creditedPlayerId');
  const requestId = requireText(body.requestId, 'requestId', { max: 64 });
  const metadata = readMetadata(body.metadata);
  const recordedBy = optionalText(operator, 'operator', { max: 60 }) ?? null;
  if (eliminatedTeamId === creditedTeamId) {
    throw badRequest('A team cannot be eliminated by itself: eliminatedTeamId and creditedTeamId must differ');
  }

  return runInTransaction(db, () =>
    runIdempotent(
      db,
      { requestId, signature: `elimination:${matchId}:${eliminatedTeamId}:${creditedTeamId}:${creditedPlayerId}` },
      () => {
        const match = getMatch(db, matchId);
        requireInProgress(match);
        const eliminatedTeam = requireActiveTeam(db, match.eventId, eliminatedTeamId);
        const creditedTeam = requireActiveTeam(db, match.eventId, creditedTeamId);

        if (creditedPlayerId !== null) {
          const player = db.prepare('SELECT id, name, team_id, active FROM players WHERE id = ?').get(creditedPlayerId);
          if (!player) throw badRequest(`Player ${creditedPlayerId} does not exist`);
          if (player.team_id !== creditedTeamId) {
            throw badRequest(`Player "${player.name}" does not belong to the credited team "${creditedTeam.name}"`);
          }
          if (player.active !== 1) throw badRequest(`Player "${player.name}" is inactive`);
        }

        const earlier = db
          .prepare("SELECT id FROM elimination_events WHERE match_id = ? AND eliminated_team_id = ? AND status = 'active'")
          .get(matchId, eliminatedTeamId);
        if (earlier) {
          throw conflict(`Team "${eliminatedTeam.name}" was already eliminated in this match (event ${earlier.id}). Void that event first to record it again.`);
        }

        const { lastInsertRowid } = db
          .prepare(
            `INSERT INTO elimination_events (match_id, eliminated_team_id, credited_team_id, credited_player_id, recorded_by, metadata_json)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(matchId, eliminatedTeamId, creditedTeamId, creditedPlayerId, recordedBy, JSON.stringify(metadata));
        const eliminationId = Number(lastInsertRowid);
        recordAudit(db, match.eventId, 'elimination.record', 'elimination_event', eliminationId, {
          matchId, matchNumber: match.matchNumber, eliminatedTeamId, creditedTeamId, creditedPlayerId,
        });
        return { elimination: getEliminationEvent(db, eliminationId) };
      },
    ),
  );
}

// Marks an event as voided (a mistake). The row stays in the history.
export function voidElimination(db, matchId, eliminationId, input = {}) {
  const body = requireObject(input);
  const reason = optionalText(body.reason, 'reason', { max: 200 });
  return runInTransaction(db, () => {
    const match = getMatch(db, matchId);
    requireInProgress(match);
    const current = getEliminationEvent(db, eliminationId);
    if (current.matchId !== matchId) throw notFound(`Elimination event ${eliminationId} does not belong to match ${matchId}`);
    if (current.status === 'voided') throw conflict(`Elimination event ${eliminationId} is already voided`);
    db.prepare("UPDATE elimination_events SET status = 'voided', void_reason = ?, voided_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
      .run(reason, eliminationId);
    recordAudit(db, match.eventId, 'elimination.void', 'elimination_event', eliminationId, { matchId, reason });
    return { elimination: getEliminationEvent(db, eliminationId) };
  });
}
