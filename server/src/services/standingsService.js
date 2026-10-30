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
export function compareStandingRows(rowA, rowB, tieBreakers) {
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
//   results:      team_match_results rows for those matches (they hold the team finish totals)
// Player finishes (Player Finish Audit) are deliberately NOT used here, so they can never
// add team points a second time.
export function buildStandings({ teams, matches, results, scoring }) {
  const resultByKey = new Map(results.map((row) => [`${row.match_id}:${row.team_id}`, row]));

  const rows = teams.map((team) => {
    const row = {
      teamId: team.id,
      name: team.name,
      shortName: team.shortName,
      logoPath: team.logoPath,
      matchesPlayed: 0,
      wwcd: 0,
      placementPoints: 0,
      finishCount: 0,
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
        row.finishCount += result.finish_count;
        row.wwcd += result.is_wwcd;
      } else {
        const score = scoreTeamMatch(scoring, { placement, finishCount: result?.finish_count ?? 0 });
        row.placementPoints += score.placementPoints;
        row.finishPoints += score.finishPoints;
        row.finishCount += result?.finish_count ?? 0;
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
    return buildStandings({ teams, matches, results: [], scoring });
  }

  const placeholders = matchIds.map(() => '?').join(', ');
  const results = db.prepare(`SELECT * FROM team_match_results WHERE match_id IN (${placeholders})`).all(...matchIds);
  return buildStandings({ teams, matches, results, scoring });
}

// Splits standings into consecutive pages of at most `pageSize` teams (ranks 1-10, 11-20, ...).
// The number of pages follows the real team count: 20 teams / 10 per page = 2 pages, 21 = 3 (the
// last one holds the single remaining team), 0 teams = no pages. Nothing is repeated or skipped.
export function splitIntoPages(items, pageSize) {
  const size = Number.isInteger(pageSize) && pageSize >= 1 ? pageSize : 1;
  const pages = [];
  for (let start = 0; start < items.length; start += size) {
    pages.push(items.slice(start, start + size));
  }
  return pages;
}

// Which page the compact leaderboard shows. `appearance` is how many times the leaderboard has
// been put on the display: the first appearance shows page 1, the next page 2, and so on, wrapping
// around after the last page. It always stays valid if the team count (page count) changes.
export function pageIndexForAppearance(appearance, pageCount) {
  if (pageCount <= 0) return 0;
  const completedAppearances = Number.isInteger(appearance) && appearance > 0 ? appearance : 1;
  return (completedAppearances - 1) % pageCount;
}
