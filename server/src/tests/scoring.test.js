import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../errors.js';
import { adjustTeamFinishes, clearPlacement, getMatchDetail, setPlacement } from '../services/scoringService.js';
import { placementPointsFor, scoreTeamMatch } from '../services/scoringRules.js';
import { computeStandings } from '../services/standingsService.js';
import { defaultTournamentConfig } from '../services/defaultTournamentConfig.js';
import { addTeamFinishes, changeScoring, createTestTournament, nextRequestId, startNewMatch } from './testHelpers.js';

function teamLine(db, matchId, teamId) {
  return getMatchDetail(db, matchId).teams.find((team) => team.teamId === teamId);
}

function assertConflict(work, messagePart) {
  assert.throws(work, (error) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.status, 409);
    if (messagePart) assert.match(error.message, messagePart);
    return true;
  });
}

describe('team finish totals', () => {
  it('increments a team finish count', () => {
    const { db, eventId, teams } = createTestTournament();
    const match = startNewMatch(db, eventId);
    const result = adjustTeamFinishes(db, match.id, teams[0].id, { delta: 1, requestId: nextRequestId() });
    assert.equal(result.finishCount, 1);
    assert.equal(teamLine(db, match.id, teams[0].id).finishCount, 1);
    assert.equal(teamLine(db, match.id, teams[0].id).finishEntered, true);
  });

  it('decrements a team finish count', () => {
    const { db, eventId, teams } = createTestTournament();
    const match = startNewMatch(db, eventId);
    addTeamFinishes(db, match.id, teams[0].id, 3);
    const result = adjustTeamFinishes(db, match.id, teams[0].id, { delta: -1, requestId: nextRequestId() });
    assert.equal(result.finishCount, 2);
    assert.equal(teamLine(db, match.id, teams[0].id).finishCount, 2);
  });

  it('rejects decrementing zero and leaves the total unchanged', () => {
    const { db, eventId, teams } = createTestTournament();
    const match = startNewMatch(db, eventId);
    assertConflict(() => adjustTeamFinishes(db, match.id, teams[0].id, { delta: -1, requestId: nextRequestId() }), /below zero/);
    assert.equal(teamLine(db, match.id, teams[0].id).finishCount, 0);

    addTeamFinishes(db, match.id, teams[0].id, 1);
    adjustTeamFinishes(db, match.id, teams[0].id, { delta: -1, requestId: nextRequestId() });
    assertConflict(() => adjustTeamFinishes(db, match.id, teams[0].id, { delta: -1, requestId: nextRequestId() }), /below zero/);
    assert.equal(teamLine(db, match.id, teams[0].id).finishCount, 0);
  });

  it('rejects an invalid delta, a missing request id and unknown teams', () => {
    const { db, eventId, teams } = createTestTournament();
    const match = startNewMatch(db, eventId);
    for (const input of [{ delta: 2, requestId: 'a' }, { delta: 0, requestId: 'b' }, { delta: '1', requestId: 'c' }, { delta: 1 }]) {
      assert.throws(() => adjustTeamFinishes(db, match.id, teams[0].id, input), (error) => error.status === 400);
    }
    assert.throws(() => adjustTeamFinishes(db, match.id, 9999, { delta: 1, requestId: 'd' }), (error) => error.status === 400);
    assert.equal(teamLine(db, match.id, teams[0].id).finishCount, 0);
  });

  it('calculates finish points from the configured points per elimination', () => {
    const { db, eventId, teams } = createTestTournament();
    changeScoring(db, eventId, { finishPointsPerElimination: 2 });
    const match = startNewMatch(db, eventId);
    addTeamFinishes(db, match.id, teams[0].id, 4);
    assert.equal(teamLine(db, match.id, teams[0].id).finishPoints, 8);
    assert.equal(computeStandings(db, eventId).find((row) => row.teamId === teams[0].id).finishPoints, 8);
  });

  it('keeps the finish total when a placement is cleared, and drops empty rows', () => {
    const { db, eventId, teams } = createTestTournament();
    const match = startNewMatch(db, eventId);
    setPlacement(db, match.id, teams[0].id, { placement: 1 });
    addTeamFinishes(db, match.id, teams[0].id, 2);
    clearPlacement(db, match.id, teams[0].id);
    const line = teamLine(db, match.id, teams[0].id);
    assert.equal(line.placement, null);
    assert.equal(line.finishCount, 2);
    assert.equal(line.placementPoints, 0);

    setPlacement(db, match.id, teams[1].id, { placement: 2 });
    clearPlacement(db, match.id, teams[1].id);
    const rows = db.prepare('SELECT COUNT(*) AS n FROM team_match_results WHERE team_id = ?').get(teams[1].id).n;
    assert.equal(rows, 0);
  });
});

describe('duplicate submissions', () => {
  it('repeating a request with the same requestId changes the total only once', () => {
    const { db, eventId, teams } = createTestTournament();
    const match = startNewMatch(db, eventId);
    const request = { delta: 1, requestId: 'double-click-1' };

    const first = adjustTeamFinishes(db, match.id, teams[0].id, request);
    const second = adjustTeamFinishes(db, match.id, teams[0].id, request);

    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(second.finishCount, 1);
    assert.equal(teamLine(db, match.id, teams[0].id).finishCount, 1);
  });

  it('deliberate repeated clicks with new request ids register separately', () => {
    const { db, eventId, teams } = createTestTournament();
    const match = startNewMatch(db, eventId);
    addTeamFinishes(db, match.id, teams[0].id, 5);
    assert.equal(teamLine(db, match.id, teams[0].id).finishCount, 5);
  });

  it('a repeated decrement removes only one finish', () => {
    const { db, eventId, teams } = createTestTournament();
    const match = startNewMatch(db, eventId);
    addTeamFinishes(db, match.id, teams[0].id, 3);
    adjustTeamFinishes(db, match.id, teams[0].id, { delta: -1, requestId: 'minus-1' });
    adjustTeamFinishes(db, match.id, teams[0].id, { delta: -1, requestId: 'minus-1' });
    assert.equal(teamLine(db, match.id, teams[0].id).finishCount, 2);
  });

  it('refuses to reuse a request id for a different change', () => {
    const { db, eventId, teams } = createTestTournament();
    const match = startNewMatch(db, eventId);
    adjustTeamFinishes(db, match.id, teams[0].id, { delta: 1, requestId: 'shared-id' });
    assertConflict(() => adjustTeamFinishes(db, match.id, teams[1].id, { delta: 1, requestId: 'shared-id' }), /different change/);
  });

  it('a rejected request does not use up its request id', () => {
    const { db, eventId, teams } = createTestTournament();
    const match = startNewMatch(db, eventId);
    assertConflict(() => adjustTeamFinishes(db, match.id, teams[0].id, { delta: -1, requestId: 'retry-me' }));
    // The id was not stored, so the same request can be retried once its cause is fixed.
    adjustTeamFinishes(db, match.id, teams[0].id, { delta: 1, requestId: 'other' });
    const retried = adjustTeamFinishes(db, match.id, teams[0].id, { delta: -1, requestId: 'retry-me' });
    assert.equal(retried.duplicate, false);
    assert.equal(retried.finishCount, 0);
  });
});

describe('placement points, WWCD and match rank', () => {
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
    const { db, eventId, teams } = createTestTournament();
    const match = startNewMatch(db, eventId);
    setPlacement(db, match.id, teams[0].id, { placement: 1 });
    addTeamFinishes(db, match.id, teams[0].id, 2);

    const line = teamLine(db, match.id, teams[0].id);
    const standingsRow = computeStandings(db, eventId).find((row) => row.teamId === teams[0].id);
    assert.equal(line.totalPoints, line.placementPoints + line.finishPoints);
    assert.equal(standingsRow.totalPoints, line.totalPoints);
    assert.equal(standingsRow.wwcd, 1);
  });

  it('ranks teams within the match by total points', () => {
    const { db, eventId, teams } = createTestTournament();
    const match = startNewMatch(db, eventId);
    addTeamFinishes(db, match.id, teams[2].id, 5);
    addTeamFinishes(db, match.id, teams[0].id, 1);
    const ranks = Object.fromEntries(getMatchDetail(db, match.id).teams.map((team) => [team.teamId, team.matchRank]));
    assert.equal(ranks[teams[2].id], 1);
    assert.equal(ranks[teams[0].id], 2);
  });

  it('reports duplicate and missing placements when the rules allow duplicates', () => {
    const { db, eventId, teams } = createTestTournament();
    changeScoring(db, eventId, { allowDuplicatePlacements: true });
    const match = startNewMatch(db, eventId);
    setPlacement(db, match.id, teams[0].id, { placement: 2 });
    setPlacement(db, match.id, teams[1].id, { placement: 2 });
    setPlacement(db, match.id, teams[2].id, { placement: 3 });

    const detail = getMatchDetail(db, match.id);
    assert.equal(detail.summary.placementsEntered, 3);
    assert.equal(detail.summary.teamCount, 4);
    assert.deepEqual(detail.summary.duplicatePlacements, [{ placement: 2, teams: [teams[0].name, teams[1].name] }]);
    assert.equal(detail.teams.find((team) => team.teamId === teams[0].id).placementDuplicate, true);
    assert.equal(detail.teams.find((team) => team.teamId === teams[2].id).placementDuplicate, false);
  });
});
