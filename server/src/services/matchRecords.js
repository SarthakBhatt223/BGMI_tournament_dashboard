// Small helpers shared by the scoring and player-audit services.
import { badRequest, conflict, notFound } from '../errors.js';

export function toMatchDto(row) {
  return {
    id: row.id,
    eventId: row.event_id,
    matchNumber: row.match_number,
    label: row.label,
    status: row.status,
    createdAt: row.created_at,
    finalizedAt: row.finalized_at,
  };
}

export function getMatch(db, matchId) {
  const row = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
  if (!row) throw notFound(`Match ${matchId} does not exist`);
  return toMatchDto(row);
}

// Scores can only change while a match is in progress. Finalized matches go through "reopen".
export function requireInProgress(match) {
  if (match.status === 'in_progress') return;
  if (match.status === 'finalized') {
    throw conflict(`Match ${match.matchNumber} is finalized. Reopen it to change results.`);
  }
  throw conflict(`Match ${match.matchNumber} has not started. Start it first.`);
}

export function requireActiveTeam(db, eventId, teamId) {
  const team = db.prepare('SELECT id, name, active FROM teams WHERE id = ? AND event_id = ?').get(teamId, eventId);
  if (!team) throw badRequest(`Team ${teamId} does not exist in this event`);
  if (team.active !== 1) throw badRequest(`Team "${team.name}" is inactive`);
  return team;
}

// Makes a +1/-1 request safe to repeat. The first call runs `work` and remembers its response
// under `requestId`; a repeat with the same id returns that response and changes nothing.
// Reusing an id for a different request is an error. Must be called inside a transaction, so
// a failed `work` leaves no trace and the request can be retried.
export function runIdempotent(db, { requestId, signature }, work) {
  const existing = db.prepare('SELECT signature, response_json FROM score_requests WHERE request_id = ?').get(requestId);
  if (existing) {
    if (existing.signature !== signature) throw conflict('requestId was already used for a different change');
    return { ...JSON.parse(existing.response_json), duplicate: true };
  }
  const response = work();
  db.prepare('INSERT INTO score_requests (request_id, signature, response_json) VALUES (?, ?, ?)')
    .run(requestId, signature, JSON.stringify(response));
  return { ...response, duplicate: false };
}
