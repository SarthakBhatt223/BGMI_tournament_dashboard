// Cumulative team standings, always derived from saved records and the scoring configuration.
import { getTournamentConfig } from './eventService.js';
import { scoreTeamMatch } from './scoringRules.js';

// Direction of each tie-breaker: 'higher' wins with a larger value, 'lower' with a smaller one.
const TIE_BREAKER_DIRECTION = {
  wwcd: 'higher',
  placementPoints: 'higher',
  finishPoints: 'higher',
  bestPlacement: 'lower',
};

// Compares two standing rows. Order: total points, then the configured tie-breakers in order,
// then team id. The team-id fallback is only a technical rule that keeps the order stable
// and repeatable; it is NOT an official competitive tie-breaker.
function compareStandingRows(rowA, rowB, tieBreakers) {
  if (rowA.totalPoints !== rowB.totalPoints) return rowB.totalPoints - rowA.totalPoints;
  for (const key of tieBreakers) {
    const valueA = rowA[key];
    const valueB = rowB[key];
    if (valueA === valueB) continue;
    if (valueA === null) return 1; // an unplayed team (no placement yet) ranks behind
    if (valueB === null) return -1;
    return TIE_BREAKER_DIRECTION[key] === 'lower' ? valueA - valueB : valueB - valueA;
  }
  return rowA.teamId - rowB.teamId;
}

// Pure calculation, separated from the database so it can be tested directly.
//   teams:        active teams to rank (every one appears in the output)
//   matches:      matches that count: [{ id, status }]
//   results:      team_match_results rows for those matches
//   finishCounts: [{ matchId, teamId, finishCount }] from the finish ledger
export function buildStandings({ teams, matches, results, finishCounts, scoring }) {
  const resultByKey = new Map(results.map((row) => [`${row.match_id}:${row.team_id}`, row]));
  const finishCountByKey = new Map(finishCounts.map((row) => [`${row.matchId}:${row.teamId}`, row.finishCount]));

  const rows = teams.map((team) => {
    const row = {
      teamId: team.id,
      name: team.name,
      shortName: team.shortName,
      logoPath: team.logoPath,
      matchesPlayed: 0,
      wwcd: 0,
      placementPoints: 0,
      finishPoints: 0,
      totalPoints: 0,
      bestPlacement: null,
    };
    for (const match of matches) {
      const key = `${match.id}:${team.id}`;
      const result = resultByKey.get(key);
      const placement = result?.placement ?? null;

      if (match.status === 'finalized') {
        if (!result) continue; // the team did not take part in this match
        row.matchesPlayed += 1;
        row.placementPoints += result.placement_points;
        row.finishPoints += result.finish_points_snapshot ?? 0;
        row.wwcd += result.is_wwcd;
      } else {
        const score = scoreTeamMatch(scoring, { placement, finishCount: finishCountByKey.get(key) ?? 0 });
        row.placementPoints += score.placementPoints;
        row.finishPoints += score.finishPoints;
        row.wwcd += score.isWwcd ? 1 : 0;
      }
      if (placement !== null && (row.bestPlacement === null || placement < row.bestPlacement)) {
        row.bestPlacement = placement;
      }
    }
    row.totalPoints = row.placementPoints + row.finishPoints;
    return row;
  });

  rows.sort((rowA, rowB) => compareStandingRows(rowA, rowB, scoring.tieBreakers));
  return rows.map((row, index) => ({ rank: index + 1, ...row }));
}

export function computeStandings(db, eventId) {
  const scoring = getTournamentConfig(db, eventId).scoring;
  const statuses = scoring.countInProgressMatchInStandings ? ['finalized', 'in_progress'] : ['finalized'];

  const teams = db
    .prepare('SELECT id, name, short_name, logo_path FROM teams WHERE event_id = ? AND active = 1')
    .all(eventId)
    .map((row) => ({ id: row.id, name: row.name, shortName: row.short_name, logoPath: row.logo_path }));

  const matches = db
    .prepare(`SELECT id, status FROM matches WHERE event_id = ? AND status IN (${statuses.map(() => '?').join(', ')})`)
    .all(eventId, ...statuses);
  const matchIds = matches.map((match) => match.id);
  if (matchIds.length === 0) {
    return buildStandings({ teams, matches, results: [], finishCounts: [], scoring });
  }

  const placeholders = matchIds.map(() => '?').join(', ');
  const results = db.prepare(`SELECT * FROM team_match_results WHERE match_id IN (${placeholders})`).all(...matchIds);
  const finishCounts = db
    .prepare(
      `SELECT match_id, team_id, COUNT(*) AS finish_count FROM finish_events
       WHERE reversed_at IS NULL AND match_id IN (${placeholders}) GROUP BY match_id, team_id`,
    )
    .all(...matchIds)
    .map((row) => ({ matchId: row.match_id, teamId: row.team_id, finishCount: row.finish_count }));

  return buildStandings({ teams, matches, results, finishCounts, scoring });
}

// Splits standings into pages for the scrolling leaderboard. Every page is full: when the
// last page would be short, it starts earlier and repeats a few teams, so no team is omitted
// and the display never shows a mostly empty page.
export function splitIntoPages(items, pageSize) {
  if (items.length <= pageSize) return items.length === 0 ? [] : [items];
  const pages = [];
  for (let start = 0; start + pageSize < items.length; start += pageSize) {
    pages.push(items.slice(start, start + pageSize));
  }
  pages.push(items.slice(items.length - pageSize));
  return pages;
}
