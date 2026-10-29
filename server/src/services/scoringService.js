// Match lifecycle and score entry. This is the only place that writes finishes, placements
// and match status. Team finish points are NEVER stored per finish: they are derived from the
// finish_events ledger, so a finish can never be counted twice.
import { runInTransaction, toFlag } from '../db/database.js';
import { badRequest, conflict, notFound, unprocessable } from '../errors.js';
import { recordAudit } from './auditService.js';
import { setCurrentMatch } from './broadcastService.js';
import { getTournamentConfig } from './eventService.js';
import { placementPointsFor, scoreTeamMatch } from './scoringRules.js';
import { optionalText, requireInteger, requireObject, requireText } from '../validation.js';

// ---------- reading ----------

function toMatchDto(row) {
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

export function listMatches(db, eventId) {
  return db
    .prepare('SELECT * FROM matches WHERE event_id = ? ORDER BY match_number')
    .all(eventId)
    .map(toMatchDto);
}

function toFinishEventDto(row) {
  return {
    id: row.id,
    matchId: row.match_id,
    teamId: row.team_id,
    playerId: row.player_id,
    playerName: row.player_name ?? null,
    createdAt: row.created_at,
    reversedAt: row.reversed_at,
  };
}

function getFinishEventRow(db, finishEventId) {
  const row = db.prepare('SELECT * FROM finish_events WHERE id = ?').get(finishEventId);
  if (!row) throw notFound(`Finish event ${finishEventId} does not exist`);
  return row;
}

export function listFinishEvents(db, matchId, { limit = 100 } = {}) {
  getMatch(db, matchId);
  return db
    .prepare(
      `SELECT finish_events.*, players.name AS player_name
       FROM finish_events LEFT JOIN players ON players.id = finish_events.player_id
       WHERE match_id = ? ORDER BY finish_events.id DESC LIMIT ?`,
    )
    .all(matchId, limit)
    .map(toFinishEventDto);
}

// Scoreboard for a single match. In-progress matches are scored live from the configuration;
// finalized matches report the values frozen at finalization.
export function getMatchDetail(db, matchId) {
  const match = getMatch(db, matchId);
  const scoring = getTournamentConfig(db, match.eventId).scoring;

  const finishCountByTeam = new Map(
    db
      .prepare('SELECT team_id, COUNT(*) AS finish_count FROM finish_events WHERE match_id = ? AND reversed_at IS NULL GROUP BY team_id')
      .all(matchId)
      .map((row) => [row.team_id, row.finish_count]),
  );
  const resultByTeam = new Map(
    db.prepare('SELECT * FROM team_match_results WHERE match_id = ?').all(matchId).map((row) => [row.team_id, row]),
  );
  const playerFinishes = db
    .prepare(
      `SELECT player_match_stats.player_id, player_match_stats.team_id, player_match_stats.finish_count, players.name AS player_name
       FROM player_match_stats JOIN players ON players.id = player_match_stats.player_id
       WHERE player_match_stats.match_id = ?`,
    )
    .all(matchId);
  const unattributedByTeam = new Map(
    db
      .prepare('SELECT team_id, COUNT(*) AS finish_count FROM finish_events WHERE match_id = ? AND reversed_at IS NULL AND player_id IS NULL GROUP BY team_id')
      .all(matchId)
      .map((row) => [row.team_id, row.finish_count]),
  );

  const teamRows = db
    .prepare(
      `SELECT id, name, short_name, logo_path, active FROM teams
       WHERE event_id = ?
         AND (active = 1
              OR id IN (SELECT team_id FROM team_match_results WHERE match_id = ?)
              OR id IN (SELECT team_id FROM finish_events WHERE match_id = ?))
       ORDER BY name COLLATE NOCASE, id`,
    )
    .all(match.eventId, matchId, matchId);

  const teams = teamRows.map((team) => {
    const result = resultByTeam.get(team.id);
    const placement = result?.placement ?? null;
    const finishCount = finishCountByTeam.get(team.id) ?? 0;
    const isFrozen = match.status === 'finalized' && result?.finish_points_snapshot !== null && result !== undefined;
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
      finishCount,
      unattributedFinishCount: unattributedByTeam.get(team.id) ?? 0,
      players: playerFinishes
        .filter((entry) => entry.team_id === team.id)
        .map((entry) => ({ playerId: entry.player_id, name: entry.player_name, finishCount: entry.finish_count })),
      ...score,
    };
  });

  const finishEvents = listFinishEvents(db, matchId, { limit: 100 });
  const lastActiveFinish = finishEvents.find((event) => event.reversedAt === null);

  return {
    match,
    teams,
    finishEvents,
    lastUndoableFinishEventId: match.status === 'in_progress' && lastActiveFinish ? lastActiveFinish.id : null,
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

function requireInProgress(match) {
  if (match.status === 'in_progress') return;
  if (match.status === 'finalized') {
    throw conflict(`Match ${match.matchNumber} is finalized. Reopen it to change results.`);
  }
  throw conflict(`Match ${match.matchNumber} has not started. Start it first.`);
}

function requireActiveTeam(db, eventId, teamId) {
  const team = db.prepare('SELECT id, name, active FROM teams WHERE id = ? AND event_id = ?').get(teamId, eventId);
  if (!team) throw badRequest(`Team ${teamId} does not exist in this event`);
  if (team.active !== 1) throw badRequest(`Team "${team.name}" is inactive`);
  return team;
}

// ---------- finishes ----------

// Adds one finish. `requestId` makes the call idempotent: repeating it (double click, retry
// after a network error) returns the original finish instead of adding another.
export function addFinish(db, matchId, input) {
  const body = requireObject(input);
  const teamId = requireInteger(body.teamId, 'teamId', { min: 1 });
  const playerId = body.playerId === undefined || body.playerId === null ? null : requireInteger(body.playerId, 'playerId', { min: 1 });
  const requestId = optionalText(body.requestId, 'requestId', { max: 64 });

  return runInTransaction(db, () => {
    if (requestId) {
      const existing = db.prepare('SELECT * FROM finish_events WHERE idempotency_key = ?').get(requestId);
      if (existing) {
        const sameRequest = existing.match_id === matchId && existing.team_id === teamId && existing.player_id === playerId;
        if (!sameRequest) throw conflict('requestId was already used for a different finish');
        return { finishEvent: toFinishEventDto(existing), duplicate: true };
      }
    }

    const match = getMatch(db, matchId);
    requireInProgress(match);
    const scoring = getTournamentConfig(db, match.eventId).scoring;
    requireActiveTeam(db, match.eventId, teamId);

    if (playerId === null) {
      if (!scoring.allowUnattributedFinishes) {
        throw badRequest('Select the player who earned the finish. Unattributed finishes are disabled in the configuration.');
      }
    } else {
      const player = db.prepare('SELECT team_id, name, active FROM players WHERE id = ?').get(playerId);
      if (!player) throw badRequest(`Player ${playerId} does not exist`);
      if (player.team_id !== teamId) throw badRequest(`Player "${player.name}" does not belong to the selected team`);
      if (player.active !== 1) throw badRequest(`Player "${player.name}" is inactive`);
    }

    const { total } = db
      .prepare('SELECT COUNT(*) AS total FROM finish_events WHERE match_id = ? AND reversed_at IS NULL')
      .get(matchId);
    if (total >= scoring.maxFinishesPerMatch) {
      throw conflict(`This match already has ${total} finishes, the configured maximum.`);
    }

    const { lastInsertRowid } = db
      .prepare('INSERT INTO finish_events (event_id, match_id, team_id, player_id, idempotency_key) VALUES (?, ?, ?, ?, ?)')
      .run(match.eventId, matchId, teamId, playerId, requestId);
    const finishEventId = Number(lastInsertRowid);
    recordAudit(db, match.eventId, 'finish.add', 'finish_event', finishEventId, { matchId, teamId, playerId });
    return { finishEvent: toFinishEventDto(getFinishEventRow(db, finishEventId)), duplicate: false };
  });
}

// Reverses a specific finish. Undoing an already reversed finish is a harmless no-op, so a
// double-clicked "Undo" can never remove two finishes.
export function undoFinish(db, finishEventId) {
  return runInTransaction(db, () => {
    const finishEvent = getFinishEventRow(db, finishEventId);
    if (finishEvent.reversed_at !== null) {
      return { finishEvent: toFinishEventDto(finishEvent), duplicate: true };
    }
    requireInProgress(getMatch(db, finishEvent.match_id));
    db.prepare("UPDATE finish_events SET reversed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(finishEventId);
    recordAudit(db, finishEvent.event_id, 'finish.undo', 'finish_event', finishEventId, {
      matchId: finishEvent.match_id, teamId: finishEvent.team_id, playerId: finishEvent.player_id,
    });
    return { finishEvent: toFinishEventDto(getFinishEventRow(db, finishEventId)), duplicate: false };
  });
}

// Correction = reverse the wrong finish and record a new one for the right player of the
// same team. Both rows stay in the ledger. Wrong team? Undo it and add a new finish instead.
export function correctFinishPlayer(db, finishEventId, input) {
  const body = requireObject(input);
  const newPlayerId = requireInteger(body.playerId, 'playerId', { min: 1 });
  return runInTransaction(db, () => {
    const original = getFinishEventRow(db, finishEventId);
    if (original.reversed_at !== null) throw conflict('That finish was already undone and cannot be corrected');
    requireInProgress(getMatch(db, original.match_id));
    const player = db.prepare('SELECT team_id, name, active FROM players WHERE id = ?').get(newPlayerId);
    if (!player) throw badRequest(`Player ${newPlayerId} does not exist`);
    if (player.team_id !== original.team_id) throw badRequest(`Player "${player.name}" does not belong to the team of this finish`);
    if (player.active !== 1) throw badRequest(`Player "${player.name}" is inactive`);
    if (newPlayerId === original.player_id) {
      throw badRequest('The finish is already assigned to that player');
    }

    db.prepare("UPDATE finish_events SET reversed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(finishEventId);
    const { lastInsertRowid } = db
      .prepare('INSERT INTO finish_events (event_id, match_id, team_id, player_id) VALUES (?, ?, ?, ?)')
      .run(original.event_id, original.match_id, original.team_id, newPlayerId);
    const replacementId = Number(lastInsertRowid);
    recordAudit(db, original.event_id, 'finish.correct', 'finish_event', replacementId, {
      replacedFinishEventId: finishEventId, fromPlayerId: original.player_id, toPlayerId: newPlayerId,
    });
    return { finishEvent: toFinishEventDto(getFinishEventRow(db, replacementId)), duplicate: false };
  });
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

export function clearPlacement(db, matchId, teamId) {
  return runInTransaction(db, () => {
    const match = getMatch(db, matchId);
    requireInProgress(match);
    const removed = db.prepare('DELETE FROM team_match_results WHERE match_id = ? AND team_id = ?').run(matchId, teamId);
    if (removed.changes > 0) {
      recordAudit(db, match.eventId, 'placement.clear', 'match', matchId, { teamId });
    }
    return getMatchDetail(db, matchId);
  });
}

// ---------- finalization ----------

function findFinalizationProblems(db, match, scoring) {
  const problems = [];
  const activeTeams = db.prepare('SELECT id, name FROM teams WHERE event_id = ? AND active = 1').all(match.eventId);
  const results = db.prepare('SELECT team_id, placement FROM team_match_results WHERE match_id = ?').all(match.id);
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
  const finishesByTeam = db
    .prepare('SELECT team_id, COUNT(*) AS finish_count FROM finish_events WHERE match_id = ? AND reversed_at IS NULL GROUP BY team_id')
    .all(match.id);
  for (const { team_id: teamId, finish_count: finishCount } of finishesByTeam) {
    if (!activeTeamIds.has(teamId)) {
      problems.push(`Team "${teamNameById.get(teamId)}" has ${finishCount} finish(es) but is inactive.`);
    }
  }

  const totalFinishes = finishesByTeam.reduce((sum, row) => sum + row.finish_count, 0);
  if (totalFinishes > scoring.maxFinishesPerMatch) {
    problems.push(`Total finishes (${totalFinishes}) exceed the configured maximum of ${scoring.maxFinishesPerMatch}.`);
  }

  const { unattributed } = db
    .prepare('SELECT COUNT(*) AS unattributed FROM finish_events WHERE match_id = ? AND reversed_at IS NULL AND player_id IS NULL')
    .get(match.id);
  if (unattributed > 0 && !scoring.allowUnattributedFinishes) {
    problems.push(`${unattributed} finish(es) have no player, which the configuration does not allow.`);
  }

  // Player statistics and team results must agree. Both derive from the same ledger, so a
  // mismatch means the data was changed outside the application.
  const { attributed } = db
    .prepare('SELECT COALESCE(SUM(finish_count), 0) AS attributed FROM player_match_stats WHERE match_id = ?')
    .get(match.id);
  if (attributed + unattributed !== totalFinishes) {
    problems.push('Player statistics do not add up to the team finish totals.');
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

    const finishCountByTeam = new Map(
      db
        .prepare('SELECT team_id, COUNT(*) AS finish_count FROM finish_events WHERE match_id = ? AND reversed_at IS NULL GROUP BY team_id')
        .all(matchId)
        .map((row) => [row.team_id, row.finish_count]),
    );
    const placementByTeam = new Map(
      db.prepare('SELECT team_id, placement FROM team_match_results WHERE match_id = ?').all(matchId).map((row) => [row.team_id, row.placement]),
    );
    const participatingTeamIds = new Set([...placementByTeam.keys(), ...finishCountByTeam.keys()]);
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
      const placement = placementByTeam.get(teamId) ?? null;
      const score = scoreTeamMatch(scoring, { placement, finishCount: finishCountByTeam.get(teamId) ?? 0 });
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
      .prepare('SELECT team_id, placement, placement_points, is_wwcd, finish_points_snapshot FROM team_match_results WHERE match_id = ?')
      .all(matchId);
    db.prepare('UPDATE team_match_results SET finish_points_snapshot = NULL WHERE match_id = ?').run(matchId);
    db.prepare("UPDATE matches SET status = 'in_progress', finalized_at = NULL WHERE id = ?").run(matchId);
    setCurrentMatch(db, matchId);
    recordAudit(db, match.eventId, 'match.reopen', 'match', matchId, { reason, previousSnapshot });
    return getMatchDetail(db, matchId);
  });
}
