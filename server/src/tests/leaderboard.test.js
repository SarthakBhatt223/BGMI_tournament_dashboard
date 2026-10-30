import assert from 'node:assert/strict';
import os from 'node:os';
import { describe, it } from 'node:test';
import { AppError } from '../errors.js';
import { exportBackup, restoreBackup, validateBackup } from '../services/backupService.js';
import { updateBroadcastState } from '../services/broadcastService.js';
import { getTournamentConfig, validateTournamentConfig } from '../services/eventService.js';
import { buildState } from '../services/stateService.js';
import { addTeamFinishes, changeDisplay, createTestTournament, startNewMatch } from './testHelpers.js';

const stateOf = (db) => buildState(db, { mediaDirectory: os.tmpdir() });
const ranksOf = (page) => page.map((row) => row.rank);
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => from + index);

function show(db, eventId, mode, extra = {}) {
  return updateBroadcastState(db, eventId, { mode, ...extra });
}

describe('compact leaderboard with 20 teams', () => {
  it('defaults to 10 teams per page and builds ranks 1-10 and 11-20', () => {
    const { db, eventId } = createTestTournament({ teamCount: 20, playersPerTeam: 1 });
    assert.equal(getTournamentConfig(db, eventId).display.teamsPerPage, 10);
    const state = stateOf(db);
    assert.equal(state.standings.length, 20);
    assert.equal(state.standingsPages.length, 2);
    assert.deepEqual(ranksOf(state.standingsPages[0]), range(1, 10));
    assert.deepEqual(ranksOf(state.standingsPages[1]), range(11, 20));
    assert.deepEqual(
      { teamCount: state.leaderboard.teamCount, teamsPerPage: state.leaderboard.teamsPerPage, pageCount: state.leaderboard.pageCount },
      { teamCount: 20, teamsPerPage: 10, pageCount: 2 },
    );
  });

  it('pages follow the real standings order', () => {
    const { db, eventId, teams } = createTestTournament({ teamCount: 20, playersPerTeam: 1 });
    const match = startNewMatch(db, eventId);
    addTeamFinishes(db, match.id, teams[19].id, 5); // last registered team leads
    addTeamFinishes(db, match.id, teams[12].id, 3);
    const state = stateOf(db);
    assert.equal(state.standingsPages[0][0].teamId, teams[19].id);
    assert.equal(state.standingsPages[0][1].teamId, teams[12].id);
    assert.deepEqual(state.standingsPages.flat().map((row) => row.teamId), state.standings.map((row) => row.teamId));
  });

  it('alternates page 1 and page 2 on successive appearances', () => {
    const { db, eventId } = createTestTournament({ teamCount: 20, playersPerTeam: 1 });
    const seen = [];
    for (let appearance = 0; appearance < 5; appearance += 1) {
      show(db, eventId, 'standings', { leaderboardLayout: 'scrolling' });
      seen.push(stateOf(db).leaderboard.currentPageIndex);
      show(db, eventId, 'ambient');
    }
    assert.deepEqual(seen, [0, 1, 0, 1, 0]);
  });

  it('shows the same page to every viewer until the next appearance', () => {
    const { db, eventId } = createTestTournament({ teamCount: 20, playersPerTeam: 1 });
    show(db, eventId, 'standings');
    show(db, eventId, 'ambient');
    show(db, eventId, 'standings'); // second appearance -> page 2
    const first = stateOf(db).leaderboard.currentPageIndex;
    show(db, eventId, 'standings', { headlineText: 'Finals' }); // already showing: not a new appearance
    show(db, eventId, 'standings', { leaderboardLayout: 'full' });
    show(db, eventId, 'standings', { leaderboardLayout: 'scrolling' });
    assert.equal(first, 1);
    assert.equal(stateOf(db).leaderboard.currentPageIndex, 1);
    assert.equal(stateOf(db).broadcast.leaderboardAppearance, 2);
  });

  it('switching to the MVP view and back counts as a new appearance', () => {
    const { db, eventId } = createTestTournament({ teamCount: 20, playersPerTeam: 1 });
    show(db, eventId, 'standings');
    show(db, eventId, 'mvp');
    show(db, eventId, 'standings');
    assert.equal(stateOf(db).leaderboard.currentPageIndex, 1);
  });

  it('lets the operator advance the page by hand without leaving the leaderboard', () => {
    const { db, eventId } = createTestTournament({ teamCount: 20, playersPerTeam: 1 });
    show(db, eventId, 'standings');
    assert.equal(stateOf(db).leaderboard.currentPageIndex, 0);
    updateBroadcastState(db, eventId, { advanceLeaderboardPage: true });
    assert.equal(stateOf(db).leaderboard.currentPageIndex, 1);
    updateBroadcastState(db, eventId, { advanceLeaderboardPage: true });
    assert.equal(stateOf(db).leaderboard.currentPageIndex, 0);
    assert.throws(() => updateBroadcastState(db, eventId, { advanceLeaderboardPage: 'yes' }), (error) => error instanceof AppError && error.status === 400);
  });

  it('the full leaderboard still contains every registered team', () => {
    const { db, eventId } = createTestTournament({ teamCount: 20, playersPerTeam: 1 });
    show(db, eventId, 'standings', { leaderboardLayout: 'full' });
    const state = stateOf(db);
    assert.equal(state.broadcast.leaderboardLayout, 'full');
    assert.equal(state.standings.length, 20);
    assert.deepEqual(state.standings.map((row) => row.rank), range(1, 20));
  });
});

describe('pagination for other team counts and page sizes', () => {
  const cases = [
    { teams: 1, perPage: 10, pages: [1] },
    { teams: 9, perPage: 10, pages: [9] },
    { teams: 10, perPage: 10, pages: [10] },
    { teams: 11, perPage: 10, pages: [10, 1] },
    { teams: 15, perPage: 10, pages: [10, 5] },
    { teams: 18, perPage: 10, pages: [10, 8] },
    { teams: 21, perPage: 10, pages: [10, 10, 1] },
    { teams: 25, perPage: 10, pages: [10, 10, 5] },
    { teams: 30, perPage: 10, pages: [10, 10, 10] },
    { teams: 20, perPage: 7, pages: [7, 7, 6] },
    { teams: 20, perPage: 20, pages: [20] },
    { teams: 20, perPage: 50, pages: [20] },
    { teams: 20, perPage: 1, pages: Array(20).fill(1) },
  ];
  for (const { teams, perPage, pages } of cases) {
    it(`${teams} teams at ${perPage} per page -> ${pages.length} page(s)`, () => {
      const { db, eventId } = createTestTournament({ teamCount: teams, playersPerTeam: 1 });
      changeDisplay(db, eventId, { teamsPerPage: perPage });
      const state = stateOf(db);
      assert.deepEqual(state.standingsPages.map((page) => page.length), pages);
      assert.deepEqual(state.standingsPages.flat().map((row) => row.rank), range(1, teams));
      assert.equal(state.leaderboard.pageCount, pages.length);

      // Cycling through appearances visits every page once, in order, then wraps.
      const visited = [];
      for (let appearance = 0; appearance < pages.length + 1; appearance += 1) {
        show(db, eventId, 'standings');
        visited.push(stateOf(db).leaderboard.currentPageIndex);
        show(db, eventId, 'ambient');
      }
      assert.deepEqual(visited, [...range(0, pages.length - 1), 0]);
    });
  }

  it('shows no pages and a valid page index when no team is registered', () => {
    const { db, eventId } = createTestTournament({ teamCount: 0 });
    show(db, eventId, 'standings');
    const state = stateOf(db);
    assert.deepEqual(state.standingsPages, []);
    assert.deepEqual([state.leaderboard.pageCount, state.leaderboard.currentPageIndex], [0, 0]);
  });

  it('keeps the page valid when teams are added between appearances', () => {
    const { db, eventId } = createTestTournament({ teamCount: 20, playersPerTeam: 1 });
    for (let appearance = 0; appearance < 3; appearance += 1) {
      show(db, eventId, 'standings');
      show(db, eventId, 'ambient');
    }
    changeDisplay(db, eventId, { teamsPerPage: 5 }); // now 4 pages
    show(db, eventId, 'standings'); // 4th appearance
    const { leaderboard } = stateOf(db);
    assert.equal(leaderboard.pageCount, 4);
    assert.equal(leaderboard.currentPageIndex, 3);
  });
});

describe('leaderboard configuration', () => {
  it('rejects an invalid teamsPerPage', () => {
    const { db, eventId } = createTestTournament({ teamCount: 2 });
    for (const bad of [0, -1, 51, 2.5, 'ten']) {
      assert.throws(() => changeDisplay(db, eventId, { teamsPerPage: bad }), (error) => error instanceof AppError && error.status === 400, `value ${bad}`);
    }
    assert.equal(getTournamentConfig(db, eventId).display.teamsPerPage, 10);
  });

  it('accepts a saved configuration from before teamsPerPage existed', () => {
    const { db, eventId } = createTestTournament({ teamCount: 20, playersPerTeam: 1 });
    const saved = JSON.parse(db.prepare('SELECT config_json FROM event_config').get().config_json);
    delete saved.display.teamsPerPage;
    delete saved.display.rotatePagesWhileVisible;
    saved.display.scrollPageSize = 9; // the key used by the previous version
    db.prepare('UPDATE event_config SET config_json = ?').run(JSON.stringify(saved));

    const config = getTournamentConfig(db, eventId);
    assert.equal(config.display.teamsPerPage, 10);
    assert.equal(config.display.rotatePagesWhileVisible, false);
    assert.equal('scrollPageSize' in config.display, false);
    assert.equal(stateOf(db).standingsPages.length, 2);
    assert.doesNotThrow(() => validateTournamentConfig(saved)); // old backups carry such a config
  });
});

describe('leaderboard appearance and backups', () => {
  it('a backup keeps the appearance counter', () => {
    const { db, eventId } = createTestTournament({ teamCount: 20, playersPerTeam: 1 });
    show(db, eventId, 'standings');
    show(db, eventId, 'ambient');
    show(db, eventId, 'standings');
    const backup = JSON.parse(JSON.stringify(exportBackup(db)));
    assert.deepEqual(validateBackup(backup), []);

    const target = createTestTournament({ teamCount: 2 });
    restoreBackup(target.db, backup);
    assert.equal(stateOf(target.db).broadcast.leaderboardAppearance, 2);
    assert.equal(stateOf(target.db).leaderboard.currentPageIndex, 1);
  });

  it('a backup made before the counter existed restores with it at zero', () => {
    const { db } = createTestTournament({ teamCount: 20, playersPerTeam: 1 });
    const backup = JSON.parse(JSON.stringify(exportBackup(db)));
    for (const row of backup.tables.broadcast_state) delete row.leaderboard_appearance;
    assert.deepEqual(validateBackup(backup), []);

    const target = createTestTournament({ teamCount: 2 });
    restoreBackup(target.db, backup);
    assert.equal(stateOf(target.db).broadcast.leaderboardAppearance, 0);
    assert.equal(stateOf(target.db).leaderboard.currentPageIndex, 0);
  });
});
