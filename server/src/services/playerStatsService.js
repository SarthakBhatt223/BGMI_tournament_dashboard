// Player finish statistics, derived from the finish ledger.
import { getTournamentConfig } from './eventService.js';

// Players are ranked by total finishes (competition ranking: 1, 2, 2, 4). Ties are listed by
// name so the order is repeatable. This ranking is supporting data only; the MVP is chosen
// manually by the organizer.
export function computePlayerStats(db, eventId, { search = '' } = {}) {
  const scoring = getTournamentConfig(db, eventId).scoring;
  const statuses = scoring.countInProgressMatchInStandings ? ['finalized', 'in_progress'] : ['finalized'];

  const players = db
    .prepare(
      `SELECT players.id, players.name, players.in_game_name, players.team_id, teams.name AS team_name
       FROM players JOIN teams ON teams.id = players.team_id
       WHERE teams.event_id = ? AND players.active = 1`,
    )
    .all(eventId);

  const finishRows = db
    .prepare(
      `SELECT player_match_stats.player_id, matches.id AS match_id, matches.match_number, player_match_stats.finish_count
       FROM player_match_stats JOIN matches ON matches.id = player_match_stats.match_id
       WHERE matches.event_id = ? AND matches.status IN (${statuses.map(() => '?').join(', ')})
       ORDER BY matches.match_number`,
    )
    .all(eventId, ...statuses);

  const matchFinishesByPlayer = new Map();
  for (const row of finishRows) {
    const list = matchFinishesByPlayer.get(row.player_id) ?? [];
    list.push({ matchId: row.match_id, matchNumber: row.match_number, finishCount: row.finish_count });
    matchFinishesByPlayer.set(row.player_id, list);
  }

  const stats = players.map((player) => {
    const matchFinishes = matchFinishesByPlayer.get(player.id) ?? [];
    return {
      playerId: player.id,
      name: player.name,
      inGameName: player.in_game_name,
      teamId: player.team_id,
      teamName: player.team_name,
      totalFinishes: matchFinishes.reduce((sum, entry) => sum + entry.finishCount, 0),
      matchFinishes,
    };
  });

  stats.sort((a, b) => b.totalFinishes - a.totalFinishes || a.name.localeCompare(b.name) || a.playerId - b.playerId);
  let previousFinishes = null;
  let previousRank = 0;
  const ranked = stats.map((entry, index) => {
    const rank = entry.totalFinishes === previousFinishes ? previousRank : index + 1;
    previousFinishes = entry.totalFinishes;
    previousRank = rank;
    return { rank, ...entry };
  });

  const needle = search.trim().toLowerCase();
  if (needle === '') return ranked;
  return ranked.filter((entry) =>
    [entry.name, entry.inGameName ?? '', entry.teamName].some((text) => text.toLowerCase().includes(needle)),
  );
}
