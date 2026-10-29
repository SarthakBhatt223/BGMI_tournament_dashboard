import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addFinish, createMatch, finalizeMatch, setPlacement, startMatch } from '../services/scoringService.js';
import { updateTeam } from '../services/rosterService.js';
import { computeStandings, splitIntoPages } from '../services/standingsService.js';
import { changeScoring, createTestTournament, placeTeamsInOrder, startNewMatch } from './testHelpers.js';

function finishCountOf(db, matchId, team, playersByTeamId, count) {
  const [player] = playersByTeamId.get(team.id);
  for (let index = 0; index < count; index += 1) {
    addFinish(db, matchId, { teamId: team.id, playerId: player.id });
  }
}

describe('standings', () => {
  it('sorts teams by total points', () => {
    const { db, eventId, teams, playersByTeamId } = createTestTournament();
    const match = startNewMatch(db, eventId);
    finishCountOf(db, match.id, teams[2], playersByTeamId, 5);
    finishCountOf(db, match.id, teams[0], playersByTeamId, 2);
    finishCountOf(db, match.id, teams[1], playersByTeamId, 3);

    const order = computeStandings(db, eventId).map((row) => row.teamId);
    assert.deepEqual(order.slice(0, 3), [teams[2].id, teams[1].id, teams[0].id]);
  });

  it('applies the configured tie-breakers in order', () => {
    const { db, eventId, teams, playersByTeamId } = createTestTournament({ teamCount: 2 });
    // Team A: placement 1 (10 pts) + 0 finishes. Team B: placement 2 (8 pts) + 2 finishes = 10 pts.
    changeScoring(db, eventId, { placementPoints: { 1: 10, 2: 8 }, finishPointsPerElimination: 1 });
    const match = startNewMatch(db, eventId);
    setPlacement(db, match.id, teams[0].id, { placement: 1 });
    setPlacement(db, match.id, teams[1].id, { placement: 2 });
    finishCountOf(db, match.id, teams[1], playersByTeamId, 2);

    changeScoring(db, eventId, { tieBreakers: ['placementPoints', 'finishPoints'] });
    assert.equal(computeStandings(db, eventId)[0].teamId, teams[0].id);

    changeScoring(db, eventId, { tieBreakers: ['finishPoints', 'placementPoints'] });
    assert.equal(computeStandings(db, eventId)[0].teamId, teams[1].id);
  });

  it('uses best placement as a tie-breaker where a lower number wins', () => {
    const { db, eventId, teams } = createTestTournament({ teamCount: 2 });
    changeScoring(db, eventId, { placementPoints: { 1: 5, 2: 5 }, tieBreakers: ['bestPlacement'] });
    const match = startNewMatch(db, eventId);
    setPlacement(db, match.id, teams[1].id, { placement: 1 });
    setPlacement(db, match.id, teams[0].id, { placement: 2 });
    assert.equal(computeStandings(db, eventId)[0].teamId, teams[1].id);
  });

  it('keeps unplayed teams in the table, ordered deterministically by team id', () => {
    const { db, eventId, teams } = createTestTournament();
    const standings = computeStandings(db, eventId);
    assert.equal(standings.length, teams.length);
    assert.deepEqual(standings.map((row) => row.teamId), teams.map((team) => team.id));
    assert.deepEqual(standings.map((row) => row.rank), [1, 2, 3, 4]);
    assert.ok(standings.every((row) => row.totalPoints === 0 && row.matchesPlayed === 0));
  });

  it('includes all active teams and leaves inactive teams out', () => {
    const { db, eventId, teams } = createTestTournament({ teamCount: 18 });
    assert.equal(computeStandings(db, eventId).length, 18);
    updateTeam(db, teams[5].id, { active: false });
    const standings = computeStandings(db, eventId);
    assert.equal(standings.length, 17);
    assert.ok(!standings.some((row) => row.teamId === teams[5].id));
  });

  it('aggregates several finalized matches', () => {
    const { db, eventId, teams, playersByTeamId } = createTestTournament({ teamCount: 3 });
    changeScoring(db, eventId, { placementPoints: { 1: 10, 2: 6, 3: 3 } });

    const firstMatch = startNewMatch(db, eventId);
    placeTeamsInOrder(db, firstMatch.id, [teams[0], teams[1], teams[2]]);
    finishCountOf(db, firstMatch.id, teams[0], playersByTeamId, 2);
    finalizeMatch(db, firstMatch.id);

    const secondMatch = startNewMatch(db, eventId);
    placeTeamsInOrder(db, secondMatch.id, [teams[1], teams[0], teams[2]]);
    finishCountOf(db, secondMatch.id, teams[1], playersByTeamId, 4);
    finalizeMatch(db, secondMatch.id);

    const byTeam = new Map(computeStandings(db, eventId).map((row) => [row.teamId, row]));
    assert.equal(byTeam.get(teams[0].id).totalPoints, 10 + 2 + 6);
    assert.equal(byTeam.get(teams[1].id).totalPoints, 6 + 10 + 4);
    assert.equal(byTeam.get(teams[2].id).totalPoints, 3 + 3);
    assert.equal(byTeam.get(teams[0].id).wwcd, 1);
    assert.equal(byTeam.get(teams[1].id).wwcd, 1);
    assert.equal(byTeam.get(teams[0].id).matchesPlayed, 2);
    assert.equal(computeStandings(db, eventId)[0].teamId, teams[1].id);
  });

  it('can exclude the match in progress from standings', () => {
    const { db, eventId, teams, playersByTeamId } = createTestTournament({ teamCount: 2 });
    const match = createMatch(db, eventId, {});
    startMatch(db, match.id);
    finishCountOf(db, match.id, teams[0], playersByTeamId, 3);
    assert.equal(computeStandings(db, eventId).find((row) => row.teamId === teams[0].id).totalPoints, 3);

    changeScoring(db, eventId, { countInProgressMatchInStandings: false });
    assert.equal(computeStandings(db, eventId).find((row) => row.teamId === teams[0].id).totalPoints, 0);
  });
});

describe('scrolling pages', () => {
  const makeItems = (count) => Array.from({ length: count }, (_, index) => index + 1);

  function assertCoversEveryItem(items, pages) {
    const shown = new Set(pages.flat());
    assert.deepEqual([...shown].sort((a, b) => a - b), items);
  }

  it('splits 18 teams into two pages of nine', () => {
    const items = makeItems(18);
    const pages = splitIntoPages(items, 9);
    assert.deepEqual(pages.map((page) => page.length), [9, 9]);
    assertCoversEveryItem(items, pages);
  });

  it('covers every team when the count is not a multiple of the page size', () => {
    for (const count of [10, 19, 20, 25]) {
      const items = makeItems(count);
      const pages = splitIntoPages(items, 9);
      assert.ok(pages.every((page) => page.length === 9), `all pages full for ${count} teams`);
      assertCoversEveryItem(items, pages);
    }
  });

  it('returns one short page for few teams and no pages for none', () => {
    assert.deepEqual(splitIntoPages(makeItems(5), 9), [makeItems(5)]);
    assert.deepEqual(splitIntoPages([], 9), []);
  });
});
