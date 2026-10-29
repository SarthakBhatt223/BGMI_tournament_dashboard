import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computePlayerStats } from '../services/playerStatsService.js';
import { addFinish, correctFinishPlayer, getMatchDetail, setPlacement, undoFinish } from '../services/scoringService.js';
import { placementPointsFor, scoreTeamMatch } from '../services/scoringRules.js';
import { computeStandings } from '../services/standingsService.js';
import { defaultTournamentConfig } from '../services/defaultTournamentConfig.js';
import { changeScoring, createTestTournament, nextRequestId, startNewMatch } from './testHelpers.js';

function teamLine(db, matchId, teamId) {
  return getMatchDetail(db, matchId).teams.find((team) => team.teamId === teamId);
}

describe('finish entry', () => {
  it('one finish increments the selected player finish count', () => {
    const { db, eventId, teams, playersByTeamId } = createTestTournament();
    const match = startNewMatch(db, eventId);
    const [teamOne] = teams;
    const [firstPlayer, secondPlayer] = playersByTeamId.get(teamOne.id);

    addFinish(db, match.id, { teamId: teamOne.id, playerId: firstPlayer.id, requestId: nextRequestId() });

    const line = teamLine(db, match.id, teamOne.id);
    assert.deepEqual(line.players, [{ playerId: firstPlayer.id, name: firstPlayer.name, finishCount: 1 }]);
    const stats = computePlayerStats(db, eventId);
    assert.equal(stats.find((entry) => entry.playerId === firstPlayer.id).totalFinishes, 1);
    assert.equal(stats.find((entry) => entry.playerId === secondPlayer.id).totalFinishes, 0);
  });

  it('adds the team finish points exactly once', () => {
    const { db, eventId, teams, playersByTeamId } = createTestTournament();
    const match = startNewMatch(db, eventId);
    const [teamOne] = teams;
    const [player] = playersByTeamId.get(teamOne.id);
    addFinish(db, match.id, { teamId: teamOne.id, playerId: player.id, requestId: nextRequestId() });

    const expected = defaultTournamentConfig.scoring.finishPointsPerElimination;
    assert.equal(teamLine(db, match.id, teamOne.id).finishPoints, expected);
    const standingsRow = computeStandings(db, eventId).find((row) => row.teamId === teamOne.id);
    assert.equal(standingsRow.finishPoints, expected);
    assert.equal(standingsRow.totalPoints, expected);
  });

  it('uses the configured points per elimination', () => {
    const { db, eventId, teams, playersByTeamId } = createTestTournament();
    changeScoring(db, eventId, { finishPointsPerElimination: 2 });
    const match = startNewMatch(db, eventId);
    const [teamOne] = teams;
    const [player] = playersByTeamId.get(teamOne.id);
    addFinish(db, match.id, { teamId: teamOne.id, playerId: player.id });
    addFinish(db, match.id, { teamId: teamOne.id, playerId: player.id });
    assert.equal(teamLine(db, match.id, teamOne.id).finishPoints, 4);
  });

  it('undo reverses the finish and keeps it in the ledger', () => {
    const { db, eventId, teams, playersByTeamId } = createTestTournament();
    const match = startNewMatch(db, eventId);
    const [teamOne] = teams;
    const [player] = playersByTeamId.get(teamOne.id);
    const { finishEvent } = addFinish(db, match.id, { teamId: teamOne.id, playerId: player.id });

    undoFinish(db, finishEvent.id);

    assert.equal(teamLine(db, match.id, teamOne.id).finishCount, 0);
    const ledger = getMatchDetail(db, match.id).finishEvents;
    assert.equal(ledger.length, 1);
    assert.notEqual(ledger[0].reversedAt, null);
  });

  it('repeating a request with the same requestId does not duplicate the finish', () => {
    const { db, eventId, teams, playersByTeamId } = createTestTournament();
    const match = startNewMatch(db, eventId);
    const [teamOne] = teams;
    const [player] = playersByTeamId.get(teamOne.id);
    const request = { teamId: teamOne.id, playerId: player.id, requestId: 'double-click-1' };

    const first = addFinish(db, match.id, request);
    const second = addFinish(db, match.id, request);

    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(second.finishEvent.id, first.finishEvent.id);
    assert.equal(teamLine(db, match.id, teamOne.id).finishCount, 1);
  });

  it('undoing the same finish twice removes only one finish', () => {
    const { db, eventId, teams, playersByTeamId } = createTestTournament();
    const match = startNewMatch(db, eventId);
    const [teamOne] = teams;
    const [player] = playersByTeamId.get(teamOne.id);
    addFinish(db, match.id, { teamId: teamOne.id, playerId: player.id });
    const { finishEvent: lastFinish } = addFinish(db, match.id, { teamId: teamOne.id, playerId: player.id });

    undoFinish(db, lastFinish.id);
    const repeated = undoFinish(db, lastFinish.id);

    assert.equal(repeated.duplicate, true);
    assert.equal(teamLine(db, match.id, teamOne.id).finishCount, 1);
  });

  it('correction moves a finish to another player of the same team', () => {
    const { db, eventId, teams, playersByTeamId } = createTestTournament();
    const match = startNewMatch(db, eventId);
    const [teamOne] = teams;
    const [firstPlayer, secondPlayer] = playersByTeamId.get(teamOne.id);
    const { finishEvent } = addFinish(db, match.id, { teamId: teamOne.id, playerId: firstPlayer.id });

    correctFinishPlayer(db, finishEvent.id, { playerId: secondPlayer.id });

    const line = teamLine(db, match.id, teamOne.id);
    assert.equal(line.finishCount, 1);
    assert.deepEqual(line.players.map((entry) => entry.playerId), [secondPlayer.id]);
  });
});

describe('placement points and WWCD', () => {
  it('calculates placement points from the configured table', () => {
    const scoring = defaultTournamentConfig.scoring;
    assert.equal(placementPointsFor(scoring, 1), scoring.placementPoints[1]);
    assert.equal(placementPointsFor(scoring, 3), scoring.placementPoints[3]);
    assert.equal(placementPointsFor(scoring, 17), 0);
    assert.equal(placementPointsFor(scoring, null), 0);
  });

  it('derives WWCD from the configured winning placement', () => {
    const { db, eventId, teams } = createTestTournament();
    const match = startNewMatch(db, eventId);
    setPlacement(db, match.id, teams[0].id, { placement: 1 });
    setPlacement(db, match.id, teams[1].id, { placement: 2 });
    assert.equal(teamLine(db, match.id, teams[0].id).isWwcd, true);
    assert.equal(teamLine(db, match.id, teams[1].id).isWwcd, false);

    changeScoring(db, eventId, { winnerPlacement: 2 });
    assert.equal(teamLine(db, match.id, teams[0].id).isWwcd, false);
    assert.equal(teamLine(db, match.id, teams[1].id).isWwcd, true);
  });

  it('total points equal placement points plus finish points', () => {
    const scoring = defaultTournamentConfig.scoring;
    const score = scoreTeamMatch(scoring, { placement: 2, finishCount: 5 });
    assert.equal(score.placementPoints, scoring.placementPoints[2]);
    assert.equal(score.finishPoints, 5 * scoring.finishPointsPerElimination);
    assert.equal(score.totalPoints, score.placementPoints + score.finishPoints);
  });

  it('match detail and standings agree on a team total', () => {
    const { db, eventId, teams, playersByTeamId } = createTestTournament();
    const match = startNewMatch(db, eventId);
    const [teamOne] = teams;
    const [player] = playersByTeamId.get(teamOne.id);
    setPlacement(db, match.id, teamOne.id, { placement: 1 });
    addFinish(db, match.id, { teamId: teamOne.id, playerId: player.id });
    addFinish(db, match.id, { teamId: teamOne.id, playerId: player.id });

    const line = teamLine(db, match.id, teamOne.id);
    const standingsRow = computeStandings(db, eventId).find((row) => row.teamId === teamOne.id);
    assert.equal(line.totalPoints, line.placementPoints + line.finishPoints);
    assert.equal(standingsRow.totalPoints, line.totalPoints);
    assert.equal(standingsRow.wwcd, 1);
  });
});
