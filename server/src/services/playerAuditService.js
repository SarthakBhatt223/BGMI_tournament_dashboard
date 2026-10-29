// Player Finish Audit: individual finishes per match, entered after the match from the official
// results, and the reconciliation against each team's recorded finish total.
//
// Player finishes live in the finish_events ledger (one row per finish, reversed rather than
// deleted). They are NEVER used for team points: team finish points come only from the team
// finish total in team_match_results, so nothing is counted twice.
import { runInTransaction } from '../db/database.js';
import { badRequest, conflict } from '../errors.js';
import { recordAudit } from './auditService.js';
import { getTournamentConfig } from './eventService.js';
import { getMatch, requireActiveTeam, requireInProgress, runIdempotent } from './matchRecords.js';
import { requireInteger, requireObject, requireOneOf, requireText } from '../validation.js';

// Compares one team's recorded finishes with the sum of its players' finishes.
//   match      - totals agree
//   mismatch   - totals differ (difference = team finishes minus player total)
//   incomplete - no registered players, so nothing can be verified
// A team without players and without any finishes cannot be verified but also cannot be wrong,
// so it does not block finalization.
export function reconcileTeam({ teamFinishes, playerTotal, activePlayerCount }) {
  const difference = teamFinishes - playerTotal;
  let status;
  if (activePlayerCount === 0 && playerTotal === 0) status = 'incomplete';
  else status = difference === 0 ? 'match' : 'mismatch';
  const blocksFinalization = status === 'mismatch' || (status === 'incomplete' && teamFinishes > 0);
  return { status, difference, blocksFinalization };
}

function buildTeamAudits(db, match, config) {
  const resultRows = db.prepare('SELECT team_id, finish_count, finish_entered FROM team_match_results WHERE match_id = ?').all(match.id);
  const resultByTeam = new Map(resultRows.map((row) => [row.team_id, row]));

  const stats = db
    .prepare(
      `SELECT player_match_stats.team_id, player_match_stats.player_id, player_match_stats.finish_count
       FROM player_match_stats WHERE player_match_stats.match_id = ?`,
    )
    .all(match.id);
  const finishesByTeamAndPlayer = new Map(stats.map((row) => [`${row.team_id}:${row.player_id}`, row.finish_count]));

  const players = db
    .prepare(
      `SELECT players.id, players.team_id, players.name, players.in_game_name, players.active
       FROM players JOIN teams ON teams.id = players.team_id WHERE teams.event_id = ?
       ORDER BY players.name COLLATE NOCASE, players.id`,
    )
    .all(match.eventId);
  const playerById = new Map(players.map((player) => [player.id, player]));

  const teams = db
    .prepare(
      `SELECT id, name, short_name, logo_path FROM teams
       WHERE event_id = ?
         AND (active = 1
              OR id IN (SELECT team_id FROM team_match_results WHERE match_id = ?)
              OR id IN (SELECT team_id FROM finish_events WHERE match_id = ?))
       ORDER BY name COLLATE NOCASE, id`,
    )
    .all(match.eventId, match.id, match.id);

  return teams.map((team) => {
    const rosterPlayers = players.filter((player) => player.team_id === team.id && player.active === 1);
    // Players who are no longer on the active roster but still have finishes recorded for this
    // team in this match stay visible, so a mismatch can always be traced and corrected.
    const rosterIds = new Set(rosterPlayers.map((player) => player.id));
    const formerPlayers = stats
      .filter((row) => row.team_id === team.id && !rosterIds.has(row.player_id))
      .map((row) => playerById.get(row.player_id));

    const rows = [...rosterPlayers, ...formerPlayers].map((player) => ({
      playerId: player.id,
      name: player.name,
      inGameName: player.in_game_name,
      finishes: finishesByTeamAndPlayer.get(`${team.id}:${player.id}`) ?? 0,
      onRoster: rosterIds.has(player.id),
    }));
    const playerTotal = rows.reduce((sum, player) => sum + player.finishes, 0);
    const result = resultByTeam.get(team.id);
    const teamFinishes = result?.finish_count ?? 0;
    const reconciliation = reconcileTeam({ teamFinishes, playerTotal, activePlayerCount: rosterPlayers.length });

    return {
      teamId: team.id,
      name: team.name,
      shortName: team.short_name,
      teamFinishes,
      teamFinishesEntered: (result?.finish_entered ?? 0) === 1,
      playerTotal,
      difference: reconciliation.difference,
      status: reconciliation.status,
      blocksFinalization: reconciliation.blocksFinalization,
      activePlayerCount: rosterPlayers.length,
      expectedPlayerCount: config.roster.playersPerTeam,
      rosterIncomplete: rosterPlayers.length < config.roster.playersPerTeam,
      players: rows,
    };
  });
}

// Everything the Player Finish Audit tab needs for one match, calculated from saved data.
export function getPlayerAudit(db, matchId) {
  const match = getMatch(db, matchId);
  const config = getTournamentConfig(db, match.eventId);
  const teams = buildTeamAudits(db, match, config);
  return {
    generatedAt: new Date().toISOString(),
    match,
    canEdit: match.status === 'in_progress',
    teams,
    summary: {
      teamsTotal: teams.length,
      teamsReconciled: teams.filter((team) => team.status === 'match').length,
      teamsMismatched: teams.filter((team) => team.status === 'mismatch').length,
      teamsIncomplete: teams.filter((team) => team.status === 'incomplete').length,
      teamsWithIncompleteRoster: teams.filter((team) => team.rosterIncomplete).length,
      teamFinishesTotal: teams.reduce((sum, team) => sum + team.teamFinishes, 0),
      playerFinishesTotal: teams.reduce((sum, team) => sum + team.playerTotal, 0),
    },
  };
}

// Used by match finalization: readable reasons why the match is not reconciled.
export function findReconciliationProblems(db, match) {
  const config = getTournamentConfig(db, match.eventId);
  return buildTeamAudits(db, match, config)
    .filter((team) => team.blocksFinalization)
    .map((team) =>
      team.status === 'mismatch'
        ? `Team "${team.name}": team finishes ${team.teamFinishes} but players total ${team.playerTotal}.`
        : `Team "${team.name}" has ${team.teamFinishes} finish(es) but no registered players to verify them.`,
    );
}

export function countPlayerFinishes(db, matchId) {
  return db.prepare('SELECT COUNT(*) AS total FROM finish_events WHERE match_id = ? AND reversed_at IS NULL AND player_id IS NOT NULL').get(matchId).total;
}

// Adds (+1) or removes (-1) one finish for a player in a match. Removal reverses the player's
// latest finish in the ledger; it never deletes rows and cannot go below zero.
export function adjustPlayerFinishes(db, matchId, playerId, input) {
  const body = requireObject(input);
  const delta = requireOneOf(body.delta, 'delta', [1, -1]);
  const requestId = requireText(body.requestId, 'requestId', { max: 64 });
  const requestedTeamId = body.teamId === undefined || body.teamId === null ? null : requireInteger(body.teamId, 'teamId', { min: 1 });

  return runInTransaction(db, () =>
    runIdempotent(db, { requestId, signature: `player:${matchId}:${playerId}:${requestedTeamId}:${delta}` }, () => {
      const match = getMatch(db, matchId);
      requireInProgress(match);
      const scoring = getTournamentConfig(db, match.eventId).scoring;

      const player = db
        .prepare('SELECT players.id, players.team_id, players.name, players.active FROM players JOIN teams ON teams.id = players.team_id WHERE players.id = ? AND teams.event_id = ?')
        .get(playerId, match.eventId);
      if (!player) throw badRequest(`Player ${playerId} does not exist in this event`);
      if (requestedTeamId !== null && delta === 1 && requestedTeamId !== player.team_id) {
        throw badRequest(`Player "${player.name}" does not belong to the selected team`);
      }

      let teamId;
      if (delta === 1) {
        teamId = player.team_id;
        requireActiveTeam(db, match.eventId, teamId);
        if (player.active !== 1) throw badRequest(`Player "${player.name}" is inactive`);
        if (countPlayerFinishes(db, matchId) >= scoring.maxFinishesPerMatch) {
          throw conflict(`Players already have ${scoring.maxFinishesPerMatch} finishes in this match, the configured maximum.`);
        }
        db.prepare('INSERT INTO finish_events (event_id, match_id, team_id, player_id) VALUES (?, ?, ?, ?)')
          .run(match.eventId, matchId, teamId, playerId);
      } else {
        teamId = requestedTeamId ?? player.team_id;
        const latest = db
          .prepare('SELECT id FROM finish_events WHERE match_id = ? AND player_id = ? AND team_id = ? AND reversed_at IS NULL ORDER BY id DESC LIMIT 1')
          .get(matchId, playerId, teamId);
        if (!latest) throw conflict(`"${player.name}" already has 0 finishes in this match; it cannot go below zero.`);
        db.prepare("UPDATE finish_events SET reversed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(latest.id);
      }

      const { finishes } = db
        .prepare('SELECT COUNT(*) AS finishes FROM finish_events WHERE match_id = ? AND player_id = ? AND team_id = ? AND reversed_at IS NULL')
        .get(matchId, playerId, teamId);
      recordAudit(db, match.eventId, 'player.finish.adjust', 'player', playerId, {
        matchId, matchNumber: match.matchNumber, playerName: player.name, teamId, delta, finishes,
      });
      return { matchId, playerId, teamId, finishes };
    }),
  );
}
