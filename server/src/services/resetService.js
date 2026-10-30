// "Reset scores" for testing: removes every match and everything recorded during matches, but
// keeps the roster (teams, players, logos), the event settings and the configuration.
//
// What is removed: matches, per-match results (placements, team finish totals), the finish ledger,
// elimination events, remembered +/- request ids, the selected current match and the selected MVP,
// and the leaderboard page counters.
// What is kept: teams, players, logos, event name, configuration, display mode/layout/headline,
// and the audit log (which also records that the reset happened).
import { runInTransaction } from '../db/database.js';
import { recordAudit } from './auditService.js';

function countRows(db, sql, ...params) {
  return Object.values(db.prepare(sql).get(...params))[0];
}

// What a reset would remove right now (shown in the confirmation).
export function describeScoringData(db, eventId) {
  return {
    matches: countRows(db, 'SELECT COUNT(*) FROM matches WHERE event_id = ?', eventId),
    finishEvents: countRows(db, 'SELECT COUNT(*) FROM finish_events WHERE event_id = ?', eventId),
    eliminations: countRows(db, 'SELECT COUNT(*) FROM elimination_events WHERE match_id IN (SELECT id FROM matches WHERE event_id = ?)', eventId),
  };
}

export function resetScoringData(db, eventId) {
  return runInTransaction(db, () => {
    const removed = describeScoringData(db, eventId);
    const matchIds = 'SELECT id FROM matches WHERE event_id = ?';

    // Children first, because of the foreign keys.
    db.prepare(`DELETE FROM elimination_events WHERE match_id IN (${matchIds})`).run(eventId);
    db.prepare('DELETE FROM finish_events WHERE event_id = ?').run(eventId);
    db.prepare(`DELETE FROM team_match_results WHERE match_id IN (${matchIds})`).run(eventId);
    db.prepare(
      `UPDATE broadcast_state
       SET current_match_id = NULL, mvp_player_id = NULL, leaderboard_appearance = 0,
           scheduled_leaderboard_count = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE event_id = ?`,
    ).run(eventId);
    db.prepare('DELETE FROM matches WHERE event_id = ?').run(eventId);
    db.prepare('DELETE FROM score_requests').run();

    recordAudit(db, eventId, 'tournament.reset_scores', 'event', eventId, removed);
    return removed;
  });
}
