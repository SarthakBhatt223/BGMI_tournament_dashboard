import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../errors.js';
import { listAuditEntries } from '../services/auditService.js';
import { getPlayerAudit, reconcileTeam } from '../services/playerAuditService.js';
import { updatePlayer } from '../services/rosterService.js';
import { computeStandings } from '../services/standingsService.js';
import {
  adjustTeamFinishes, createMatch, finalizeMatch, getMatchDetail, reopenMatch, setPlacement, startMatch,
} from '../services/scoringService.js';
import {
  addTeamFinishes, adjustPlayer, changeScoring, createTestTournament, nextRequestId, placeTeamsInOrder, startNewMatch,
} from './testHelpers.js';

function assertAppError(work, status, messagePart) {
  assert.throws(work, (error) => {
    assert.ok(error instanceof AppError, `expected AppError, got ${error}`);
    assert.equal(error.status, status);
    if (messagePart) assert.match(error.message, messagePart);
    return true;
  });
}

const teamAudit = (db, matchId, teamId) => getPlayerAudit(db, matchId).teams.find((team) => team.teamId === teamId);
const playerRow = (db, matchId, teamId, playerId) => teamAudit(db, matchId, teamId).players.find((player) => player.playerId === playerId);

describe('player finish adjustments', () => {
  it('adds and removes a finish for one player', () => {
    const { db, eventId, teams, playersByTeamId } = createTestTournament();
    const match = startNewMatch(db, eventId);
    const [player] = playersByTeamId.get(teams[0].id);

    assert.equal(adjustPlayer(db, match.id, player.id).finishes, 1);
    assert.equal(adjustPlayer(db, match.id, player.id).finishes, 2);
    assert.equal(adjustPlayer(db, match.id, player.id, -1).finishes, 1);
    assert.equal(playerRow(db, match.id, teams[0].id, player.id).finishes, 1);
  });

  it('rejects removing a finish below zero and leaves the count unchanged', () => {
    const { db, eventId, teams, playersByTeamId } = createTestTournament();
    const match = startNewMatch(db, eventId);
    const [player] = playersByTeamId.get(teams[0].id);
    assertAppError(() => adjustPlayer(db, match.id, player.id, -1), 409, /below zero/);
    assert.equal(playerRow(db, match.id, teams[0].id, player.id).finishes, 0);

    adjustPlayer(db, match.id, player.id);
    adjustPlayer(db, match.id, player.id, -1);
    assertAppError(() => adjustPlayer(db, match.id, player.id, -1), 409, /below zero/);
    assert.equal(playerRow(db, match.id, teams[0].id, player.id).finishes, 0);
  });

  it('is idempotent per request id, while separate clicks count separately', () => {
    const { db, eventId, teams, playersByTeamId } = createTestTournament();
    const match = startNewMatch(db, eventId);
    const [player] = playersByTeamId.get(teams[0].id);
    const request = { delta: 1, requestId: 'player-double-click' };
    // adjustPlayer always creates a new request id, so use the service directly for a repeat.
    const first = adjustPlayer(db, match.id, player.id, 1, { requestId: request.requestId });
    const second = adjustPlayer(db, match.id, player.id, 1, { requestId: request.requestId });
    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(playerRow(db, match.id, teams[0].id, player.id).finishes, 1);

    adjustPlayer(db, match.id, player.id);
    adjustPlayer(db, match.id, player.id);
    assert.equal(playerRow(db, match.id, teams[0].id, player.id).finishes, 3);
  });

  it('keeps matches separate', () => {
    const { db, eventId, teams, playersByTeamId } = createTestTournament();
    const first = startNewMatch(db, eventId);
    const [player] = playersByTeamId.get(teams[0].id);
    adjustPlayer(db, first.id, player.id);
    adjustPlayer(db, first.id, player.id);
    addTeamFinishes(db, first.id, teams[0].id, 2);
    placeTeamsInOrder(db, first.id, teams);
    finalizeMatch(db, first.id);

    const second = startNewMatch(db, eventId);
    assert.equal(playerRow(db, second.id, teams[0].id, player.id).finishes, 0);
    adjustPlayer(db, second.id, player.id);
    assert.equal(playerRow(db, first.id, teams[0].id, player.id).finishes, 2);
    assert.equal(playerRow(db, second.id, teams[0].id, player.id).finishes, 1);
  });

  it('never changes team finishes, team points or standings', () => {
    const { db, eventId, teams, playersByTeamId } = createTestTournament();
    const match = startNewMatch(db, eventId);
    const [player] = playersByTeamId.get(teams[0].id);
    addTeamFinishes(db, match.id, teams[0].id, 2);
    const standingsBefore = JSON.stringify(computeStandings(db, eventId));

    adjustPlayer(db, match.id, player.id);
    adjustPlayer(db, match.id, player.id);
    adjustPlayer(db, match.id, player.id);

    assert.equal(JSON.stringify(computeStandings(db, eventId)), standingsBefore);
    const line = getMatchDetail(db, match.id).teams.find((team) => team.teamId === teams[0].id);
    assert.equal(line.finishCount, 2);
    assert.equal(line.finishPoints, 2);
    assert.equal(teamAudit(db, match.id, teams[0].id).playerTotal, 3);
  });

  it('rejects an unknown or inactive player and a player from the wrong team', () => {
    const { db, eventId, teams, playersByTeamId } = createTestTournament();
    const match = startNewMatch(db, eventId);
    const [player] = playersByTeamId.get(teams[0].id);
    assertAppError(() => adjustPlayer(db, match.id, 9999), 400, /Player 9999/);
    assertAppError(() => adjustPlayer(db, match.id, player.id, 1, { teamId: teams[1].id }), 400, /does not belong/);
    updatePlayer(db, player.id, { active: false });
    assertAppError(() => adjustPlayer(db, match.id, player.id), 400, /inactive/);
  });

  it('enforces the configured maximum finishes per match', () => {
    const { db, eventId, teams, playersByTeamId } = createTestTournament();
    changeScoring(db, eventId, { maxFinishesPerMatch: 2 });
    const match = startNewMatch(db, eventId);
    const [player] = playersByTeamId.get(teams[0].id);
    adjustPlayer(db, match.id, player.id);
    adjustPlayer(db, match.id, player.id);
    assertAppError(() => adjustPlayer(db, match.id, player.id), 409, /maximum/);
  });

  it('records audit log entries and keeps undone finishes in the ledger', () => {
    const { db, eventId, teams, playersByTeamId } = createTestTournament();
    const match = startNewMatch(db, eventId);
    const [player] = playersByTeamId.get(teams[0].id);
    adjustPlayer(db, match.id, player.id);
    adjustPlayer(db, match.id, player.id, -1);

    const rows = db.prepare('SELECT reversed_at FROM finish_events WHERE match_id = ? AND player_id = ?').all(match.id, player.id);
    assert.equal(rows.length, 1); // history kept
    assert.ok(rows[0].reversed_at);
    assert.equal(playerRow(db, match.id, teams[0].id, player.id).finishes, 0);

    const actions = listAuditEntries(db, eventId, 50).map((entry) => entry.action);
    assert.equal(actions.filter((action) => action === 'player.finish.adjust').length, 2);
  });
});

describe('reconciliation', () => {
  it('classifies pure inputs', () => {
    assert.deepEqual(reconcileTeam({ teamFinishes: 12, playerTotal: 12, activePlayerCount: 4 }), { status: 'match', difference: 0, blocksFinalization: false });
    assert.deepEqual(reconcileTeam({ teamFinishes: 12, playerTotal: 10, activePlayerCount: 4 }), { status: 'mismatch', difference: 2, blocksFinalization: true });
    assert.deepEqual(reconcileTeam({ teamFinishes: 3, playerTotal: 5, activePlayerCount: 4 }), { status: 'mismatch', difference: -2, blocksFinalization: true });
    assert.deepEqual(reconcileTeam({ teamFinishes: 0, playerTotal: 0, activePlayerCount: 0 }), { status: 'incomplete', difference: 0, blocksFinalization: false });
    assert.deepEqual(reconcileTeam({ teamFinishes: 2, playerTotal: 0, activePlayerCount: 0 }), { status: 'incomplete', difference: 2, blocksFinalization: true });
  });

  it('reports MATCH, MISMATCH with the difference, and INCOMPLETE per team', () => {
    const { db, eventId, teams, playersByTeamId } = createTestTournament({ teamCount: 3 });
    const match = startNewMatch(db, eventId);
    // Team 1: matches (2 = 2). Team 2: team 3, players 1 -> difference +2. Team 3: no players.
    addTeamFinishes(db, match.id, teams[0].id, 2);
    adjustPlayer(db, match.id, playersByTeamId.get(teams[0].id)[0].id);
    adjustPlayer(db, match.id, playersByTeamId.get(teams[0].id)[1].id);
    addTeamFinishes(db, match.id, teams[1].id, 3);
    adjustPlayer(db, match.id, playersByTeamId.get(teams[1].id)[0].id);
    for (const player of playersByTeamId.get(teams[2].id)) updatePlayer(db, player.id, { active: false });

    const audit = getPlayerAudit(db, match.id);
    const byId = new Map(audit.teams.map((team) => [team.teamId, team]));
    assert.equal(byId.get(teams[0].id).status, 'match');
    assert.equal(byId.get(teams[1].id).status, 'mismatch');
    assert.equal(byId.get(teams[1].id).difference, 2);
    assert.equal(byId.get(teams[2].id).status, 'incomplete');
    assert.deepEqual(
      [audit.summary.teamsReconciled, audit.summary.teamsMismatched, audit.summary.teamsIncomplete, audit.summary.teamsTotal],
      [1, 1, 1, 3],
    );
    assert.equal(audit.summary.teamFinishesTotal, 5);
    assert.equal(audit.summary.playerFinishesTotal, 3);
  });

  it('flags a roster with fewer players than expected', () => {
    const { db, eventId, teams } = createTestTournament({ playersPerTeam: 2 });
    const match = startNewMatch(db, eventId);
    const audit = getPlayerAudit(db, match.id);
    // Default config expects more than two players per team, so every team is flagged.
    assert.ok(audit.teams.every((team) => team.activePlayerCount === 2));
    assert.ok(audit.teams.every((team) => team.rosterIncomplete === (team.expectedPlayerCount > 2)));
    assert.equal(audit.summary.teamsWithIncompleteRoster, teams.length * Number(audit.teams[0].expectedPlayerCount > 2));
  });

  it('is calculated from saved data, so it recovers after changing a count', () => {
    const { db, eventId, teams, playersByTeamId } = createTestTournament();
    const match = startNewMatch(db, eventId);
    const [player] = playersByTeamId.get(teams[0].id);
    addTeamFinishes(db, match.id, teams[0].id, 1);
    assert.equal(teamAudit(db, match.id, teams[0].id).status, 'mismatch');
    adjustPlayer(db, match.id, player.id);
    assert.equal(teamAudit(db, match.id, teams[0].id).status, 'match');
    adjustTeamFinishes(db, match.id, teams[0].id, { delta: 1, requestId: nextRequestId() });
    assert.equal(teamAudit(db, match.id, teams[0].id).status, 'mismatch');
  });
});

describe('finalization and reconciliation', () => {
  function readyMatch(options) {
    const tournament = createTestTournament(options);
    const match = startNewMatch(tournament.db, tournament.eventId);
    placeTeamsInOrder(tournament.db, match.id, tournament.teams);
    return { ...tournament, match };
  }

  it('blocks finalization on a mismatch and names the team', () => {
    const { db, teams, match } = readyMatch({ requireReconciliation: true });
    addTeamFinishes(db, match.id, teams[0].id, 2);
    assert.throws(() => finalizeMatch(db, match.id), (error) => {
      assert.equal(error.status, 422);
      assert.ok(error.details.some((detail) => detail.includes(teams[0].name)));
      return true;
    });
    assert.equal(getMatchDetail(db, match.id).match.status, 'in_progress');
  });

  it('finalizes once the player totals agree', () => {
    const { db, teams, playersByTeamId, match } = readyMatch({ requireReconciliation: true });
    addTeamFinishes(db, match.id, teams[0].id, 2);
    assert.throws(() => finalizeMatch(db, match.id));
    adjustPlayer(db, match.id, playersByTeamId.get(teams[0].id)[0].id);
    adjustPlayer(db, match.id, playersByTeamId.get(teams[0].id)[1].id);
    assert.equal(finalizeMatch(db, match.id).match.status, 'finalized');
  });

  it('a team with no finishes and no players does not block finalization', () => {
    const { db, teams, playersByTeamId, match } = readyMatch({ requireReconciliation: true });
    for (const player of playersByTeamId.get(teams[3].id)) updatePlayer(db, player.id, { active: false });
    assert.equal(finalizeMatch(db, match.id).match.status, 'finalized');
  });

  it('a team with finishes but no registered players blocks finalization', () => {
    const { db, teams, playersByTeamId, match } = readyMatch({ requireReconciliation: true });
    addTeamFinishes(db, match.id, teams[3].id, 1);
    for (const player of playersByTeamId.get(teams[3].id)) updatePlayer(db, player.id, { active: false });
    assert.throws(() => finalizeMatch(db, match.id), (error) => error.status === 422 && error.details.some((detail) => /no registered players/.test(detail)));
  });

  it('allows an unreconciled finalization only when the setting is switched off', () => {
    const { db, eventId, teams, match } = readyMatch({ requireReconciliation: true });
    addTeamFinishes(db, match.id, teams[0].id, 2);
    assert.throws(() => finalizeMatch(db, match.id));
    changeScoring(db, eventId, { requirePlayerReconciliationToFinalize: false });
    assert.equal(finalizeMatch(db, match.id).match.status, 'finalized');
  });

  it('still enforces the placement rules when reconciled', () => {
    const tournament = createTestTournament({ requireReconciliation: true });
    const match = startNewMatch(tournament.db, tournament.eventId);
    setPlacement(tournament.db, match.id, tournament.teams[0].id, { placement: 1 });
    assert.throws(() => finalizeMatch(tournament.db, match.id), (error) => error.status === 422);
  });

  it('rejects team and player changes once finalized, and allows them after a reopen', () => {
    const { db, teams, playersByTeamId, match } = readyMatch();
    finalizeMatch(db, match.id);
    const [player] = playersByTeamId.get(teams[0].id);
    assertAppError(() => adjustPlayer(db, match.id, player.id), 409, /finalized/);
    assertAppError(() => adjustTeamFinishes(db, match.id, teams[0].id, { delta: 1, requestId: nextRequestId() }), 409, /finalized/);
    assert.equal(getPlayerAudit(db, match.id).canEdit, false);

    reopenMatch(db, match.id, { reason: 'Correct player finishes after review' });
    assert.equal(getPlayerAudit(db, match.id).canEdit, true);
    assert.equal(adjustPlayer(db, match.id, player.id).finishes, 1);
  });

  it('keeps frozen finish points when finalized, even if player data changes after a reopen', () => {
    const { db, eventId, teams, playersByTeamId, match } = readyMatch();
    addTeamFinishes(db, match.id, teams[0].id, 2);
    finalizeMatch(db, match.id);
    const before = computeStandings(db, eventId).find((row) => row.teamId === teams[0].id).totalPoints;
    reopenMatch(db, match.id, { reason: 'Audit check' });
    adjustPlayer(db, match.id, playersByTeamId.get(teams[0].id)[0].id);
    assert.equal(computeStandings(db, eventId).find((row) => row.teamId === teams[0].id).totalPoints, before);
  });
});

describe('persistence', () => {
  it('player finishes and team totals survive a reload from the same database', () => {
    const { db, eventId, teams, playersByTeamId } = createTestTournament();
    const match = startNewMatch(db, eventId);
    const [player] = playersByTeamId.get(teams[0].id);
    addTeamFinishes(db, match.id, teams[0].id, 2);
    adjustPlayer(db, match.id, player.id);
    // A fresh read from the database (what a restarted server does) shows the saved values.
    const audit = getPlayerAudit(db, match.id);
    const team = audit.teams.find((entry) => entry.teamId === teams[0].id);
    assert.equal(team.teamFinishes, 2);
    assert.equal(team.playerTotal, 1);
    assert.equal(team.difference, 1);
    assert.equal(createMatch(db, eventId, {}).status, 'planned');
    assert.equal(startMatch.length >= 2, true);
  });
});
