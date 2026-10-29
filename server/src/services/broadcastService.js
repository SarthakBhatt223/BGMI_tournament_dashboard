// What the public display shows (persisted), the manual MVP choice, and the publisher that
// pushes committed state to connected clients.
import { runInTransaction } from '../db/database.js';
import { badRequest, notFound } from '../errors.js';
import { recordAudit } from './auditService.js';
import { optionalText, requireInteger, requireObject, requireOneOf } from '../validation.js';

export const BROADCAST_MODES = ['ambient', 'standings', 'mvp'];
export const LEADERBOARD_LAYOUTS = ['full', 'scrolling'];

export function getBroadcastState(db) {
  const row = db.prepare('SELECT * FROM broadcast_state WHERE id = 1').get();
  if (!row) throw notFound('Broadcast state is missing. Run the database migration.');
  return {
    mode: row.mode,
    leaderboardLayout: row.leaderboard_layout,
    currentMatchId: row.current_match_id,
    scrollIntervalSeconds: row.scroll_interval_seconds,
    mvpPlayerId: row.mvp_player_id,
    headlineText: row.headline_text,
    subtitleText: row.subtitle_text,
    updatedAt: row.updated_at,
  };
}

export function updateBroadcastState(db, eventId, input) {
  const body = requireObject(input);
  const current = getBroadcastState(db);

  const mode = body.mode === undefined ? current.mode : requireOneOf(body.mode, 'mode', BROADCAST_MODES);
  const leaderboardLayout =
    body.leaderboardLayout === undefined
      ? current.leaderboardLayout
      : requireOneOf(body.leaderboardLayout, 'leaderboardLayout', LEADERBOARD_LAYOUTS);
  const scrollIntervalSeconds =
    body.scrollIntervalSeconds === undefined
      ? current.scrollIntervalSeconds
      : requireInteger(body.scrollIntervalSeconds, 'scrollIntervalSeconds', { min: 3, max: 120 });
  const headlineText = body.headlineText === undefined ? current.headlineText : optionalText(body.headlineText, 'headlineText', { max: 120 });
  const subtitleText = body.subtitleText === undefined ? current.subtitleText : optionalText(body.subtitleText, 'subtitleText', { max: 120 });

  let currentMatchId = current.currentMatchId;
  if (body.currentMatchId !== undefined) {
    currentMatchId = body.currentMatchId === null ? null : requireInteger(body.currentMatchId, 'currentMatchId', { min: 1 });
    if (currentMatchId !== null && !db.prepare('SELECT 1 FROM matches WHERE id = ?').get(currentMatchId)) {
      throw badRequest(`Match ${currentMatchId} does not exist`);
    }
  }

  runInTransaction(db, () => {
    db.prepare(
      `UPDATE broadcast_state
       SET mode = ?, leaderboard_layout = ?, current_match_id = ?, scroll_interval_seconds = ?,
           headline_text = ?, subtitle_text = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = 1`,
    ).run(mode, leaderboardLayout, currentMatchId, scrollIntervalSeconds, headlineText, subtitleText);
    recordAudit(db, eventId, 'broadcast.update', 'broadcast_state', 1, {
      mode, leaderboardLayout, currentMatchId, scrollIntervalSeconds,
    });
  });
  return getBroadcastState(db);
}

export function setCurrentMatch(db, matchId) {
  db.prepare("UPDATE broadcast_state SET current_match_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 1")
    .run(matchId);
}

// The MVP is chosen by the organizer. Finish rankings never set it automatically.
export function selectMvp(db, eventId, playerId) {
  if (playerId !== null) {
    requireInteger(playerId, 'playerId', { min: 1 });
    const player = db
      .prepare('SELECT players.id, players.active, teams.event_id FROM players JOIN teams ON teams.id = players.team_id WHERE players.id = ?')
      .get(playerId);
    if (!player || player.event_id !== eventId) throw badRequest(`Player ${playerId} does not exist in this event`);
    if (player.active !== 1) throw badRequest('An inactive player cannot be selected as MVP');
  }
  runInTransaction(db, () => {
    const previous = getBroadcastState(db).mvpPlayerId;
    db.prepare("UPDATE broadcast_state SET mvp_player_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 1")
      .run(playerId);
    recordAudit(db, eventId, 'mvp.select', 'player', playerId, { previousPlayerId: previous, playerId });
  });
  return getBroadcastState(db);
}

// Runs a change, then publishes the new state. If the change throws (or its transaction rolls
// back) nothing is published, so clients never see an uncommitted update.
export function createStatePublisher({ buildState, emitState, logError = console.error }) {
  function publishNow() {
    try {
      emitState(buildState());
    } catch (error) {
      // The data is already committed; a failed broadcast must not fail the request.
      logError('Failed to publish state:', error);
    }
  }

  function commit(changeWork) {
    const result = changeWork();
    publishNow();
    return result;
  }

  return { commit, publishNow };
}
