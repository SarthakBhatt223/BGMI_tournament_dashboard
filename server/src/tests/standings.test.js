import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createMatch, finalizeMatch, setPlacement, startMatch } from '../services/scoringService.js';
import { updateTeam } from '../services/rosterService.js';
import { computeStandings, pageIndexForAppearance, splitIntoPages } from '../services/standingsService.js';
import { addTeamFinishes, changeScoring, createTestTournament, placeTeamsInOrder, startNewMatch } from './testHelpers.js';

function finishCountOf(db, matchId, team, _playersByTeamId, count) {
  addTeamFinishes(db, matchId, team.id, count);
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

describe('leaderboard pagination', () => {
  const makeItems = (count) => Array.from({ length: count }, (_, index) => index + 1);
  const flat = (pages) => pages.flat();

  it('splits 20 teams into ranks 1-10 and 11-20', () => {
    const pages = splitIntoPages(makeItems(20), 10);
    assert.equal(pages.length, 2);
    assert.deepEqual(pages[0], makeItems(10));
    assert.deepEqual(pages[1], makeItems(20).slice(10));
  });

  it('never repeats, skips or reorders a team, for any team count and page size', () => {
    for (const pageSize of [1, 3, 7, 9, 10, 20, 50]) {
      for (const count of [0, 1, 2, 9, 10, 11, 18, 19, 20, 21, 25, 30, 40, 101]) {
        const items = makeItems(count);
        const pages = splitIntoPages(items, pageSize);
        assert.deepEqual(flat(pages), items, `count ${count}, size ${pageSize}`);
        assert.equal(pages.length, Math.ceil(count / pageSize), `page count for ${count}/${pageSize}`);
        assert.ok(pages.every((page) => page.length >= 1 && page.length <= pageSize));
      }
    }
  });

  it('follows the real team count instead of assuming two pages', () => {
    assert.deepEqual(splitIntoPages(makeItems(0), 10), []);
    assert.deepEqual(splitIntoPages(makeItems(5), 10).map((page) => page.length), [5]);
    assert.deepEqual(splitIntoPages(makeItems(10), 10).map((page) => page.length), [10]);
    assert.deepEqual(splitIntoPages(makeItems(21), 10).map((page) => page.length), [10, 10, 1]);
    assert.deepEqual(splitIntoPages(makeItems(25), 10).map((page) => page.length), [10, 10, 5]);
    assert.deepEqual(splitIntoPages(makeItems(30), 10).map((page) => page.length), [10, 10, 10]);
    assert.deepEqual(splitIntoPages(makeItems(20), 7).map((page) => page.length), [7, 7, 6]);
  });

  it('falls back to one team per page for an invalid page size instead of looping forever', () => {
    for (const bad of [0, -3, 2.5, NaN, undefined, null]) {
      assert.equal(splitIntoPages(makeItems(3), bad).length, 3);
    }
  });

  it('shows page 1 on the first appearance, then alternates and wraps', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5].map((appearance) => pageIndexForAppearance(appearance, 2)), [0, 0, 1, 0, 1, 0]);
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((appearance) => pageIndexForAppearance(appearance, 3)), [0, 1, 2, 0, 1, 2, 0]);
    assert.equal(pageIndexForAppearance(9, 1), 0);
    assert.equal(pageIndexForAppearance(5, 0), 0);
  });

  it('always returns a valid page when the page count changes between appearances', () => {
    for (let appearance = 0; appearance < 40; appearance += 1) {
      for (const pageCount of [1, 2, 3, 4, 10]) {
        const index = pageIndexForAppearance(appearance, pageCount);
        assert.ok(index >= 0 && index < pageCount);
      }
    }
  });
});
