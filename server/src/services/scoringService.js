// Match lifecycle and team-level scoring: team finish totals, placements, finalization.
//
// Data model (one authoritative value per fact):
//   - A team's finish total for a match is team_match_results.finish_count. Only this feeds
//     team finish points and the standings.
//   - Individual player finishes live in the finish_events ledger and are handled by
//     playerAuditService. They never add team points; they are only reconciled against the
//     team total.
import { runInTransaction, toFlag } from '../db/database.js';
import { conflict, unprocessable } from '../errors.js';
import { recordAudit } from './auditService.js';
import { setCurrentMatch } from './broadcastService.js';
import { getTournamentConfig } from './eventService.js';
import { getMatch, requireActiveTeam, requireInProgress, runIdempotent, toMatchDto } from './matchRecords.js';
import { countPlayerFinishes, findReconciliationProblems } from './playerAuditService.js';
import { finishPointsFor, placementPointsFor, scoreTeamMatch } from './scoringRules.js';
import { compareStandingRows } from './standingsService.js';
import { optionalText, requireInteger, requireObject, requireOneOf, requireText } from '../validation.js';

export { getMatch };

// ---------- reading ----------

export function listMatches(db, eventId) {
  return db
    .prepare('SELECT * FROM matches WHERE event_id = ? ORDER BY match_number')
    .all(eventId)
    .map(toMatchDto);
}

// Player finish ledger of a match (newest first), including reversed rows.
export function listFinishEvents(db, matchId, { limit = 100 } = {}) {
  getMatch(db, matchId);
  return db
    .prepare(
      `SELECT finish_events.*, players.name AS player_name
       FROM finish_events LEFT JOIN players ON players.id = finish_events.player_id
       WHERE match_id = ? ORDER BY finish_events.id DESC LIMIT ?`,
    )
    .all(matchId, limit)
    .map((row) => ({
      id: row.id,
      matchId: row.match_id,
      teamId: row.team_id,
      playerId: row.player_id,
      playerName: row.player_name ?? null,
      createdAt: row.created_at,
      reversedAt: row.reversed_at,
    }));
}

// Team scoreboard of one match. In-progress matches are scored live from the configuration;
// finalized matches report the values frozen at finalization.
export function getMatchDetail(db, matchId) {
  const match = getMatch(db, matchId);
  const scoring = getTournamentConfig(db, match.eventId).scoring;

  const resultByTeam = new Map(
    db.prepare('SELECT * FROM team_match_results WHERE match_id = ?').all(matchId).map((row) => [row.team_id, row]),
  );
  const teamRows = db
    .prepare(
      `SELECT id, name, short_name, logo_path, active FROM teams
       WHERE event_id = ?
         AND (active = 1 OR id IN (SELECT team_id FROM team_match_results WHERE match_id = ?))
       ORDER BY name COLLATE NOCASE, id`,
    )
    .all(match.eventId, matchId);

  const teamIdsByPlacement = new Map();
  for (const [teamId, result] of resultByTeam) {
    if (result.placement === null) continue;
    teamIdsByPlacement.set(result.placement, [...(teamIdsByPlacement.get(result.placement) ?? []), teamId]);
  }

  const teams = teamRows.map((team) => {
    const result = resultByTeam.get(team.id);
    const placement = result?.placement ?? null;
    const finishCount = result?.finish_count ?? 0;
    const isFrozen = match.status === 'finalized' && result !== undefined && result.finish_points_snapshot !== null;
    const score = isFrozen
      ? {
          placementPoints: result.placement_points,
          finishPoints: result.finish_points_snapshot,
          isWwcd: result.is_wwcd === 1,
          totalPoints: result.placement_points + result.finish_points_snapshot,
        }
      : scoreTeamMatch(scoring, { placement, finishCount });
    return {
      teamId: team.id,
      name: team.name,
      shortName: team.short_name,
      logoPath: team.logo_path,
      active: team.active === 1,
      placement,
      placementDuplicate: placement !== null && teamIdsByPlacement.get(placement).length > 1,
      finishCount,
      finishEntered: (result?.finish_entered ?? 0) === 1,
      ...score,
    };
  });

  // Rank within this match, using the same ordering rules as the tournament standings.
  const rankedIds = teams
    .map((team) => ({ ...team, wwcd: team.isWwcd ? 1 : 0, bestPlacement: team.placement }))
    .sort((a, b) => compareStandingRows(a, b, scoring.tieBreakers))
    .map((team) => team.teamId);
  const rankedTeams = teams.map((team) => ({ ...team, matchRank: rankedIds.indexOf(team.teamId) + 1 }));

  const nameByTeamId = new Map(teams.map((team) => [team.teamId, team.name]));
  return {
    match,
    teams: rankedTeams,
    summary: {
      teamCount: teams.length,
      placementsEntered: teams.filter((team) => team.placement !== null).length,
      finishTotalsEntered: teams.filter((team) => team.finishEntered).length,
      duplicatePlacements: [...teamIdsByPlacement]
        .filter(([, teamIds]) => teamIds.length > 1)
        .map(([placement, teamIds]) => ({ placement, teams: teamIds.map((teamId) => nameByTeamId.get(teamId)) })),
    },
  };
}

// ---------- match lifecycle ----------

export function createMatch(db, eventId, input = {}) {
  const body = requireObject(input);
  const label = optionalText(body.label, 'label', { max: 60 });
  return runInTransaction(db, () => {
    const { next_number: matchNumber } = db
      .prepare('SELECT COALESCE(MAX(match_number), 0) + 1 AS next_number FROM matches WHERE event_id = ?')
      .get(eventId);
    const { lastInsertRowid } = db
      .prepare('INSERT INTO matches (event_id, match_number, label) VALUES (?, ?, ?)')
      .run(eventId, matchNumber, label);
    const matchId = Number(lastInsertRowid);
    // A new match becomes the current one, unless another match is being played right now.
    const matchInProgress = db.prepare("SELECT 1 FROM matches WHERE event_id = ? AND status = 'in_progress'").get(eventId);
    if (!matchInProgress) setCurrentMatch(db, matchId);
    recordAudit(db, eventId, 'match.create', 'match', matchId, { matchNumber, label });
    return getMatch(db, matchId);
  });
}

export function startMatch(db, matchId) {
  return runInTransaction(db, () => {
    const match = getMatch(db, matchId);
    if (match.status === 'in_progress') return match;
    if (match.status === 'finalized') {
      throw conflict(`Match ${match.matchNumber} is finalized. Reopen it to correct results.`);
    }
    const other = db
      .prepare("SELECT match_number FROM matches WHERE event_id = ? AND status = 'in_progress' AND id != ?")
      .get(match.eventId, matchId);
    if (other) {
      throw conflict(`Match ${other.match_number} is still in progress. Finalize it before starting another.`);
    }
    db.prepare("UPDATE matches SET status = 'in_progress' WHERE id = ?").run(matchId);
    setCurrentMatch(db, matchId);
    recordAudit(db, match.eventId, 'match.start', 'match', matchId, { matchNumber: match.matchNumber });
    return getMatch(db, matchId);
  });
}

// ---------- team finish totals ----------

function sumTeamFinishes(db, matchId) {
  return db.prepare('SELECT COALESCE(SUM(finish_count), 0) AS total FROM team_match_results WHERE match_id = ?').get(matchId).total;
}

// Adds (+1) or removes (-1) one finish from a team's total for a match.
// `requestId` makes the call idempotent: a repeat (double click, network retry) returns the
// original response instead of changing the total again. Every deliberate click uses a new id.
export function adjustTeamFinishes(db, matchId, teamId, input) {
  const body = requireObject(input);
  const delta = requireOneOf(body.delta, 'delta', [1, -1]);
  const requestId = requireText(body.requestId, 'requestId', { max: 64 });

  return runInTransaction(db, () =>
    runIdempotent(db, { requestId, signature: `team:${matchId}:${teamId}:${delta}` }, () => {
      const match = getMatch(db, matchId);
      requireInProgress(match);
      const scoring = getTournamentConfig(db, match.eventId).scoring;
      const team = requireActiveTeam(db, match.eventId, teamId);

      const current = db.prepare('SELECT finish_count FROM team_match_results WHERE match_id = ? AND team_id = ?').get(matchId, teamId)?.finish_count ?? 0;
      const next = current + delta;
      if (next < 0) {
        throw conflict(`"${team.name}" already has 0 finishes in this match; it cannot go below zero.`);
      }
      if (delta === 1 && sumTeamFinishes(db, matchId) >= scoring.maxFinishesPerMatch) {
        throw conflict(`Teams already have ${scoring.maxFinishesPerMatch} finishes in this match, the configured maximum.`);
      }

      db.prepare(
        `INSERT INTO team_match_results (match_id, team_id, finish_count, finish_entered)
         VALUES (?, ?, ?, 1)
         ON CONFLICT (match_id, team_id) DO UPDATE SET finish_count = excluded.finish_count, finish_entered = 1`,
      ).run(matchId, teamId, next);
      recordAudit(db, match.eventId, 'team.finish.adjust', 'team', teamId, {
        matchId, matchNumber: match.matchNumber, teamName: team.name, delta, finishCount: next,
      });
      return { matchId, teamId, finishCount: next, finishPoints: finishPointsFor(scoring, next) };
    }),
  );
}

// ---------- placements ----------

export function setPlacement(db, matchId, teamId, input) {
  const body = requireObject(input);
  return runInTransaction(db, () => {
    const match = getMatch(db, matchId);
    requireInProgress(match);
    const scoring = getTournamentConfig(db, match.eventId).scoring;
    const team = requireActiveTeam(db, match.eventId, teamId);

    const { active_teams: activeTeamCount } = db
      .prepare('SELECT COUNT(*) AS active_teams FROM teams WHERE event_id = ? AND active = 1')
      .get(match.eventId);
    const placement = requireInteger(body.placement, 'placement', { min: 1, max: Math.max(activeTeamCount, 1) });

    if (!scoring.allowDuplicatePlacements) {
      const holder = db
        .prepare(
          `SELECT teams.name FROM team_match_results
           JOIN teams ON teams.id = team_match_results.team_id
           WHERE match_id = ? AND placement = ? AND team_id != ?`,
        )
        .get(matchId, placement, teamId);
      if (holder) throw conflict(`Placement ${placement} is already assigned to "${holder.name}" in this match.`);
    }

    const { placementPoints, isWwcd } = scoreTeamMatch(scoring, { placement, finishCount: 0 });
    db.prepare(
      `INSERT INTO team_match_results (match_id, team_id, placement, placement_points, is_wwcd)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (match_id, team_id) DO UPDATE SET
         placement = excluded.placement,
         placement_points = excluded.placement_points,
         is_wwcd = excluded.is_wwcd`,
    ).run(matchId, teamId, placement, placementPoints, toFlag(isWwcd));
    recordAudit(db, match.eventId, 'placement.set', 'match', matchId, { teamId, teamName: team.name, placement });
    return getMatchDetail(db, matchId);
  });
}

// Removes only the placement; the team's finish total is kept.
export function clearPlacement(db, matchId, teamId) {
  return runInTransaction(db, () => {
    const match = getMatch(db, matchId);
    requireInProgress(match);
    const cleared = db
      .prepare('UPDATE team_match_results SET placement = NULL, placement_points = 0, is_wwcd = 0 WHERE match_id = ? AND team_id = ? AND placement IS NOT NULL')
      .run(matchId, teamId);
    // A row with nothing left in it would wrongly count as "played" later.
    db.prepare('DELETE FROM team_match_results WHERE match_id = ? AND team_id = ? AND placement IS NULL AND finish_count = 0 AND finish_entered = 0').run(matchId, teamId);
    if (cleared.changes > 0) {
      recordAudit(db, match.eventId, 'placement.clear', 'match', matchId, { teamId });
    }
    return getMatchDetail(db, matchId);
  });
}

// ---------- finalization ----------

function findFinalizationProblems(db, match, scoring) {
  const problems = [];
  const activeTeams = db.prepare('SELECT id, name FROM teams WHERE event_id = ? AND active = 1').all(match.eventId);
  const results = db.prepare('SELECT team_id, placement, finish_count FROM team_match_results WHERE match_id = ?').all(match.id);
  const placementByTeam = new Map(results.map((row) => [row.team_id, row.placement]));
  const teamNameById = new Map(
    db.prepare('SELECT id, name FROM teams WHERE event_id = ?').all(match.eventId).map((row) => [row.id, row.name]),
  );

  if (activeTeams.length === 0) problems.push('There are no active teams.');

  if (scoring.requireAllTeamsPlaced) {
    for (const team of activeTeams) {
      if (placementByTeam.get(team.id) == null) problems.push(`Team "${team.name}" has no placement.`);
    }
  }

  if (!scoring.allowDuplicatePlacements) {
    const teamsByPlacement = new Map();
    for (const { team_id: teamId, placement } of results) {
      if (placement == null) continue;
      teamsByPlacement.set(placement, [...(teamsByPlacement.get(placement) ?? []), teamNameById.get(teamId)]);
    }
    for (const [placement, names] of teamsByPlacement) {
      if (names.length > 1) problems.push(`Placement ${placement} is shared by: ${names.join(', ')}.`);
    }
  }

  const activeTeamIds = new Set(activeTeams.map((team) => team.id));
  for (const { team_id: teamId, finish_count: finishCount } of results) {
    if (finishCount > 0 && !activeTeamIds.has(teamId)) {
      problems.push(`Team "${teamNameById.get(teamId)}" has ${finishCount} finish(es) but is inactive.`);
    }
  }

  const totalTeamFinishes = results.reduce((sum, row) => sum + row.finish_count, 0);
  if (totalTeamFinishes > scoring.maxFinishesPerMatch) {
    problems.push(`Total team finishes (${totalTeamFinishes}) exceed the configured maximum of ${scoring.maxFinishesPerMatch}.`);
  }
  const totalPlayerFinishes = countPlayerFinishes(db, match.id);
  if (totalPlayerFinishes > scoring.maxFinishesPerMatch) {
    problems.push(`Total player finishes (${totalPlayerFinishes}) exceed the configured maximum of ${scoring.maxFinishesPerMatch}.`);
  }

  if (scoring.requirePlayerReconciliationToFinalize) {
    problems.push(...findReconciliationProblems(db, match));
  }
  return problems;
}

export function finalizeMatch(db, matchId) {
  return runInTransaction(db, () => {
    const match = getMatch(db, matchId);
    if (match.status === 'finalized') {
      throw conflict(`Match ${match.matchNumber} is already finalized.`);
    }
    requireInProgress(match);
    const scoring = getTournamentConfig(db, match.eventId).scoring;

    const problems = findFinalizationProblems(db, match, scoring);
    if (problems.length > 0) {
      throw unprocessable(`Match ${match.matchNumber} cannot be finalized yet.`, problems);
    }

    // Every team that has a result row took part; with requireAllTeamsPlaced every active team did.
    const results = db.prepare('SELECT team_id, placement, finish_count FROM team_match_results WHERE match_id = ?').all(matchId);
    const resultByTeam = new Map(results.map((row) => [row.team_id, row]));
    const participatingTeamIds = new Set(resultByTeam.keys());
    if (scoring.requireAllTeamsPlaced) {
      db.prepare('SELECT id FROM teams WHERE event_id = ? AND active = 1').all(match.eventId).forEach((team) => participatingTeamIds.add(team.id));
    }

    const writeSnapshot = db.prepare(
      `INSERT INTO team_match_results (match_id, team_id, placement, placement_points, is_wwcd, finish_points_snapshot)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (match_id, team_id) DO UPDATE SET
         placement_points = excluded.placement_points,
         is_wwcd = excluded.is_wwcd,
         finish_points_snapshot = excluded.finish_points_snapshot`,
    );
    for (const teamId of participatingTeamIds) {
      const placement = resultByTeam.get(teamId)?.placement ?? null;
      const score = scoreTeamMatch(scoring, { placement, finishCount: resultByTeam.get(teamId)?.finish_count ?? 0 });
      writeSnapshot.run(matchId, teamId, placement, placementPointsFor(scoring, placement), toFlag(score.isWwcd), score.finishPoints);
    }

    db.prepare("UPDATE matches SET status = 'finalized', finalized_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(matchId);
    recordAudit(db, match.eventId, 'match.finalize', 'match', matchId, {
      matchNumber: match.matchNumber, teamsScored: participatingTeamIds.size,
    });
    return getMatchDetail(db, matchId);
  });
}

// Controlled correction: reopen a finalized match. The frozen snapshot is saved in the audit
// log first, so what was published earlier can always be reviewed.
export function reopenMatch(db, matchId, input) {
  const body = requireObject(input);
  const reason = requireText(body.reason, 'reason', { max: 200 });
  return runInTransaction(db, () => {
    const match = getMatch(db, matchId);
    if (match.status !== 'finalized') throw conflict(`Match ${match.matchNumber} is not finalized.`);
    const other = db
      .prepare("SELECT match_number FROM matches WHERE event_id = ? AND status = 'in_progress'")
      .get(match.eventId);
    if (other) throw conflict(`Match ${other.match_number} is in progress. Finalize it before reopening another match.`);

    const previousSnapshot = db
      .prepare('SELECT team_id, placement, placement_points, is_wwcd, finish_count, finish_points_snapshot FROM team_match_results WHERE match_id = ?')
      .all(matchId);
    db.prepare('UPDATE team_match_results SET finish_points_snapshot = NULL WHERE match_id = ?').run(matchId);
    db.prepare("UPDATE matches SET status = 'in_progress', finalized_at = NULL WHERE id = ?").run(matchId);
    setCurrentMatch(db, matchId);
    recordAudit(db, match.eventId, 'match.reopen', 'match', matchId, { reason, previousSnapshot });
    return getMatchDetail(db, matchId);
  });
}
