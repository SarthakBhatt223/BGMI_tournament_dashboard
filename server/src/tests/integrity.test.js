import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { openDatabase, runInTransaction } from '../db/database.js';
import { migrate } from '../db/migrate.js';
import { seedDemoData } from '../db/seed.js';
import { AppError } from '../errors.js';
import { createStatePublisher, selectMvp, updateBroadcastState } from '../services/broadcastService.js';
import { exportBackup, restoreBackup, validateBackup } from '../services/backupService.js';
import { listAuditEntries } from '../services/auditService.js';
import { createTeam, deleteTeam, listTeams } from '../services/rosterService.js';
import { buildState } from '../services/stateService.js';
import { computeStandings } from '../services/standingsService.js';
import { adjustPlayerFinishes, getPlayerAudit } from '../services/playerAuditService.js';
import { getTournamentConfig } from '../services/eventService.js';
import {
  adjustTeamFinishes, createMatch, finalizeMatch, getMatch, getMatchDetail, reopenMatch, setPlacement, startMatch,
} from '../services/scoringService.js';
import { addTeamFinishes, adjustPlayer, changeScoring, createTestTournament, placeTeamsInOrder, startNewMatch } from './testHelpers.js';

function assertAppError(work, status, messagePart) {
  assert.throws(work, (error) => {
    assert.ok(error instanceof AppError, `expected AppError, got ${error}`);
    assert.equal(error.status, status);
    if (messagePart) assert.match(error.message, messagePart);
    return true;
  });
}

describe('database setup', () => {
  it('migrates a fresh database and is safe to run twice', () => {
    const db = openDatabase(':memory:');
    assert.deepEqual(migrate(db), [1, 2, 3, 4]);
    assert.deepEqual(migrate(db), []);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM events').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM broadcast_state').get().n, 1);
  });

  it('creates the database file and its folder when they do not exist', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bgmi-test-'));
    const databasePath = path.join(directory, 'nested', 'tournament.db');
    const db = openDatabase(databasePath);
    migrate(db);
    db.close();
    assert.ok(fs.existsSync(databasePath));
    const reopened = openDatabase(databasePath);
    assert.deepEqual(migrate(reopened), []);
    reopened.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('upgrades a version 1 database and keeps team finish totals and standings unchanged', () => {
    const db = openDatabase(':memory:');
    migrate(db, { targetVersion: 1 });
    const eventId = db.prepare('SELECT id FROM events').get().id;
    db.prepare("INSERT INTO teams (id, event_id, name) VALUES (1, ?, 'Old A'), (2, ?, 'Old B')").run(eventId, eventId);
    db.prepare("INSERT INTO players (id, team_id, name) VALUES (1, 1, 'Old Player')").run();
    db.prepare("INSERT INTO matches (id, event_id, match_number, status) VALUES (1, ?, 1, 'in_progress')").run(eventId);
    const insertFinish = db.prepare('INSERT INTO finish_events (event_id, match_id, team_id, player_id, reversed_at) VALUES (?, 1, 1, 1, ?)');
    insertFinish.run(eventId, null);
    insertFinish.run(eventId, null);
    insertFinish.run(eventId, '2026-01-01T00:00:00.000Z'); // an undone finish must not count

    assert.deepEqual(migrate(db), [2, 3, 4]);
    const row = db.prepare('SELECT finish_count, finish_entered FROM team_match_results WHERE match_id = 1 AND team_id = 1').get();
    assert.deepEqual({ ...row }, { finish_count: 2, finish_entered: 1 });
    assert.equal(computeStandings(db, eventId).find((entry) => entry.teamId === 1).finishPoints, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM finish_events').get().n, 3); // history kept
  });

  it('fills missing newer settings in an older saved configuration', () => {
    const { db, eventId } = createTestTournament();
    const saved = JSON.parse(db.prepare('SELECT config_json FROM event_config').get().config_json);
    delete saved.scoring.requirePlayerReconciliationToFinalize;
    saved.scoring.allowUnattributedFinishes = false; // key from the previous version
    db.prepare('UPDATE event_config SET config_json = ?').run(JSON.stringify(saved));
    assert.equal(getTournamentConfig(db, eventId).scoring.requirePlayerReconciliationToFinalize, true);
  });

  it('seeds clearly fictional placeholder teams once', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    assert.equal(seedDemoData(db).seeded, true);
    assert.equal(seedDemoData(db).seeded, false);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM teams').get().n, 20);
  });

  it('data survives closing and reopening the database file', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bgmi-test-'));
    const databasePath = path.join(directory, 'tournament.db');
    const first = openDatabase(databasePath);
    migrate(first);
    seedDemoData(first);
    first.close();

    const second = openDatabase(databasePath);
    migrate(second);
    assert.equal(second.prepare('SELECT COUNT(*) AS n FROM players').get().n, 80);
    second.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
});

describe('data integrity', () => {
  it('rejects invalid team and player references', () => {
    const { db, eventId, teams, playersByTeamId } = createTestTournament();
    const match = startNewMatch(db, eventId);
    const [teamOne, teamTwo] = teams;
    const [playerOfTeamOne] = playersByTeamId.get(teamOne.id);

    assertAppError(() => adjustTeamFinishes(db, match.id, 9999, { delta: 1, requestId: 'r1' }), 400, /Team 9999/);
    assertAppError(() => adjustPlayerFinishes(db, match.id, 9999, { delta: 1, requestId: 'r2' }), 400, /Player 9999/);
    assertAppError(() => adjustPlayerFinishes(db, match.id, playerOfTeamOne.id, { delta: 1, requestId: 'r3', teamId: teamTwo.id }), 400, /does not belong/);
    assertAppError(() => adjustPlayerFinishes(db, match.id, playerOfTeamOne.id, { delta: 1 }), 400, /requestId/);
    assertAppError(() => adjustPlayerFinishes(db, match.id, playerOfTeamOne.id, { delta: 5, requestId: 'r4' }), 400, /delta/);
    assertAppError(() => setPlacement(db, match.id, 9999, { placement: 1 }), 400);
    assert.equal(getPlayerAudit(db, match.id).summary.playerFinishesTotal, 0);
    assert.equal(getMatchDetail(db, match.id).summary.finishTotalsEntered, 0);
  });

  it('rejects out-of-range placements and duplicate placements', () => {
    const { db, eventId, teams } = createTestTournament();
    const match = startNewMatch(db, eventId);
    assertAppError(() => setPlacement(db, match.id, teams[0].id, { placement: 0 }), 400);
    assertAppError(() => setPlacement(db, match.id, teams[0].id, { placement: 5 }), 400);
    assertAppError(() => setPlacement(db, match.id, teams[0].id, { placement: 'first' }), 400);

    setPlacement(db, match.id, teams[0].id, { placement: 1 });
    assertAppError(() => setPlacement(db, match.id, teams[1].id, { placement: 1 }), 409, /already assigned/);
    setPlacement(db, match.id, teams[0].id, { placement: 1 }); // same team, same value: fine
  });

  it('allows duplicate placements only when the rules permit them', () => {
    const { db, eventId, teams } = createTestTournament();
    changeScoring(db, eventId, { allowDuplicatePlacements: true });
    const match = startNewMatch(db, eventId);
    setPlacement(db, match.id, teams[0].id, { placement: 1 });
    setPlacement(db, match.id, teams[1].id, { placement: 1 });
  });

  it('rejects score changes unless the match is in progress', () => {
    const { db, eventId, teams, playersByTeamId } = createTestTournament();
    const planned = createMatch(db, eventId, {});
    const [player] = playersByTeamId.get(teams[0].id);
    assertAppError(() => adjustTeamFinishes(db, planned.id, teams[0].id, { delta: 1, requestId: 'p1' }), 409, /not started/);
    assertAppError(() => adjustPlayerFinishes(db, planned.id, player.id, { delta: 1, requestId: 'p2' }), 409, /not started/);
  });

  it('makes a new match current only when no match is in progress', () => {
    const { db, eventId } = createTestTournament();
    const first = createMatch(db, eventId, {});
    assert.equal(buildState(db, { mediaDirectory: os.tmpdir() }).broadcast.currentMatchId, first.id);
    startMatch(db, first.id);
    createMatch(db, eventId, {});
    assert.equal(buildState(db, { mediaDirectory: os.tmpdir() }).broadcast.currentMatchId, first.id);
  });

  it('allows only one match in progress at a time', () => {
    const { db, eventId } = createTestTournament();
    startNewMatch(db, eventId);
    const second = createMatch(db, eventId, {});
    assertAppError(() => startMatch(db, second.id), 409, /in progress/);
  });

  it('rolls back every change when a transaction fails midway', () => {
    const { db, eventId } = createTestTournament();
    const teamsBefore = listTeams(db, eventId).length;
    assert.throws(() =>
      runInTransaction(db, () => {
        createTeam(db, eventId, { name: 'Temporary Team' });
        throw new Error('simulated failure after the first write');
      }),
    );
    assert.equal(listTeams(db, eventId).length, teamsBefore);
  });

  it('a failed finalization leaves the match open and writes no results', () => {
    const { db, eventId, teams } = createTestTournament();
    const match = startNewMatch(db, eventId);
    setPlacement(db, match.id, teams[0].id, { placement: 1 }); // the other teams are missing
    assertAppError(() => finalizeMatch(db, match.id), 422, /cannot be finalized/);
    assert.equal(getMatch(db, match.id).status, 'in_progress');
    const frozen = db.prepare('SELECT COUNT(*) AS n FROM team_match_results WHERE finish_points_snapshot IS NOT NULL').get().n;
    assert.equal(frozen, 0);
  });

  it('reports every finalization problem with team names', () => {
    const { db, eventId, teams } = createTestTournament();
    const match = startNewMatch(db, eventId);
    setPlacement(db, match.id, teams[0].id, { placement: 1 });
    try {
      finalizeMatch(db, match.id);
      assert.fail('expected finalization to fail');
    } catch (error) {
      assert.equal(error.status, 422);
      assert.ok(error.details.some((problem) => problem.includes('Team 2')));
    }
  });

  it('a finalized match cannot be finalized twice', () => {
    const { db, eventId, teams } = createTestTournament();
    const match = startNewMatch(db, eventId);
    placeTeamsInOrder(db, match.id, teams);
    finalizeMatch(db, match.id);
    assertAppError(() => finalizeMatch(db, match.id), 409, /already finalized/);
    const totals = computeStandings(db, eventId).map((row) => row.totalPoints);
    assertAppError(() => finalizeMatch(db, match.id), 409);
    assert.deepEqual(computeStandings(db, eventId).map((row) => row.totalPoints), totals);
  });

  it('finalized results are frozen against later rule changes, and reopening is audited', () => {
    const { db, eventId, teams } = createTestTournament();
    const match = startNewMatch(db, eventId);
    placeTeamsInOrder(db, match.id, teams);
    addTeamFinishes(db, match.id, teams[0].id, 1);
    finalizeMatch(db, match.id);
    const totalBefore = computeStandings(db, eventId)[0].totalPoints;

    changeScoring(db, eventId, { finishPointsPerElimination: 50 });
    assert.equal(computeStandings(db, eventId)[0].totalPoints, totalBefore);

    assertAppError(() => adjustTeamFinishes(db, match.id, teams[0].id, { delta: 1, requestId: 'late' }), 409, /finalized/);
    assertAppError(() => reopenMatch(db, match.id, {}), 400, /reason/);
    reopenMatch(db, match.id, { reason: 'Operator entered a wrong placement' });
    assert.equal(getMatch(db, match.id).status, 'in_progress');
    assert.ok(listAuditEntries(db).some((entry) => entry.action === 'match.reopen'));

    finalizeMatch(db, match.id);
    assert.ok(computeStandings(db, eventId)[0].totalPoints > totalBefore); // re-scored with the new rule
  });

  it('refuses to delete teams that have match history', () => {
    const { db, eventId, teams } = createTestTournament();
    const match = startNewMatch(db, eventId);
    setPlacement(db, match.id, teams[0].id, { placement: 1 });
    assertAppError(() => deleteTeam(db, teams[0].id), 409, /match history/);
    deleteTeam(db, teams[3].id);
    assert.equal(listTeams(db, eventId).length, 3);
  });

  it('keeps the team recorded on a player finish when the player later changes team', () => {
    const { db, eventId, teams, playersByTeamId } = createTestTournament();
    const match = startNewMatch(db, eventId);
    const [player] = playersByTeamId.get(teams[0].id);
    addTeamFinishes(db, match.id, teams[0].id, 1);
    adjustPlayer(db, match.id, player.id);
    db.prepare('UPDATE players SET team_id = ? WHERE id = ?').run(teams[1].id, player.id);

    const recorded = db.prepare('SELECT team_id FROM finish_events WHERE player_id = ?').get(player.id);
    assert.equal(recorded.team_id, teams[0].id);
    const audit = getPlayerAudit(db, match.id);
    const oldTeam = audit.teams.find((team) => team.teamId === teams[0].id);
    assert.equal(oldTeam.playerTotal, 1); // history is not rewritten
    assert.equal(oldTeam.players.find((entry) => entry.playerId === player.id).onRoster, false);
    assert.equal(audit.teams.find((team) => team.teamId === teams[1].id).playerTotal, 0);
    const standings = new Map(computeStandings(db, eventId).map((row) => [row.teamId, row]));
    assert.equal(standings.get(teams[0].id).finishPoints, 1);
    assert.equal(standings.get(teams[1].id).finishPoints, 0);
  });
});

describe('broadcast state and MVP', () => {
  it('accepts only allowlisted modes and layouts', () => {
    const { db, eventId } = createTestTournament();
    assertAppError(() => updateBroadcastState(db, eventId, { mode: 'fireworks' }), 400, /mode/);
    assertAppError(() => updateBroadcastState(db, eventId, { leaderboardLayout: 'tiny' }), 400);
    assertAppError(() => updateBroadcastState(db, eventId, { scrollIntervalSeconds: 1 }), 400);
    assertAppError(() => updateBroadcastState(db, eventId, { currentMatchId: 4242 }), 400);
    const updated = updateBroadcastState(db, eventId, { mode: 'standings', leaderboardLayout: 'scrolling', scrollIntervalSeconds: 12 });
    assert.deepEqual([updated.mode, updated.leaderboardLayout, updated.scrollIntervalSeconds], ['standings', 'scrolling', 12]);
  });

  it('MVP is only set by explicit selection, never by finish counts', () => {
    const { db, eventId, teams, playersByTeamId } = createTestTournament();
    const match = startNewMatch(db, eventId);
    const [topFragger, otherPlayer] = [playersByTeamId.get(teams[0].id)[0], playersByTeamId.get(teams[1].id)[0]];
    adjustPlayer(db, match.id, topFragger.id);
    const mediaDirectory = os.tmpdir();

    assert.equal(buildState(db, { mediaDirectory }).mvp, null);
    selectMvp(db, eventId, otherPlayer.id);
    const state = buildState(db, { mediaDirectory });
    assert.equal(state.mvp.playerId, otherPlayer.id);
    assert.equal(state.topFraggers[0].playerId, topFragger.id);
    assertAppError(() => selectMvp(db, eventId, 9999), 400);
    selectMvp(db, eventId, null);
    assert.equal(buildState(db, { mediaDirectory }).mvp, null);
  });
});

describe('state publishing', () => {
  it('publishes the new state after a successful change', () => {
    const { db, eventId } = createTestTournament();
    const published = [];
    const publisher = createStatePublisher({
      buildState: () => buildState(db, { mediaDirectory: os.tmpdir() }),
      emitState: (state) => published.push(state),
    });
    publisher.commit(() => updateBroadcastState(db, eventId, { mode: 'mvp' }));
    assert.equal(published.length, 1);
    assert.equal(published[0].broadcast.mode, 'mvp');
  });

  it('does not publish when the database change fails', () => {
    const { db, teams } = createTestTournament();
    const published = [];
    const publisher = createStatePublisher({
      buildState: () => buildState(db, { mediaDirectory: os.tmpdir() }),
      emitState: (state) => published.push(state),
    });
    const match = createMatch(db, 1, {}); // planned, so scoring is rejected
    assert.throws(() => publisher.commit(() => adjustTeamFinishes(db, match.id, teams[0].id, { delta: 1, requestId: 'no-publish' })));
    assert.equal(published.length, 0);
  });

  it('a failed broadcast does not fail an already committed change', () => {
    const { db, eventId } = createTestTournament();
    const logged = [];
    const publisher = createStatePublisher({
      buildState: () => buildState(db, { mediaDirectory: os.tmpdir() }),
      emitState: () => { throw new Error('socket exploded'); },
      logError: (...args) => logged.push(args),
    });
    publisher.commit(() => updateBroadcastState(db, eventId, { mode: 'standings' }));
    assert.equal(logged.length, 1);
    assert.equal(buildState(db, { mediaDirectory: os.tmpdir() }).broadcast.mode, 'standings');
  });

  it('a reconnecting client can rebuild the full display and scoring state', () => {
    const { db, eventId, teams } = createTestTournament();
    const match = startNewMatch(db, eventId);
    addTeamFinishes(db, match.id, teams[0].id, 1);
    updateBroadcastState(db, eventId, { mode: 'standings', leaderboardLayout: 'scrolling' });

    const recovered = buildState(db, { mediaDirectory: os.tmpdir() });
    assert.equal(recovered.broadcast.mode, 'standings');
    assert.equal(recovered.broadcast.leaderboardLayout, 'scrolling');
    assert.equal(recovered.currentMatch.match.id, match.id);
    assert.equal(recovered.currentMatch.teams.find((team) => team.teamId === teams[0].id).finishCount, 1);
    assert.equal(recovered.standings[0].teamId, teams[0].id);
  });

  it('reports a missing ambient video instead of failing', () => {
    const { db } = createTestTournament();
    const state = buildState(db, { mediaDirectory: path.join(os.tmpdir(), 'folder-that-does-not-exist') });
    assert.equal(state.media.ambientVideoAvailable, false);
    assert.equal(state.media.ambientVideoUrl, '/media/ambient.mp4');
  });
});

describe('backup and restore', () => {
  function tournamentWithScores() {
    const tournament = createTestTournament();
    const { db, eventId, teams, playersByTeamId } = tournament;
    const match = startNewMatch(db, eventId);
    placeTeamsInOrder(db, match.id, teams);
    const [player] = playersByTeamId.get(teams[1].id);
    addTeamFinishes(db, match.id, teams[1].id, 1);
    adjustPlayer(db, match.id, player.id);
    finalizeMatch(db, match.id);
    selectMvp(db, eventId, player.id);
    return tournament;
  }

  it('round-trips team finish totals and the player ledger, including undone finishes', () => {
    const { db, eventId, teams, playersByTeamId } = tournamentWithScores();
    const [player] = playersByTeamId.get(teams[1].id);
    const history = db.prepare('SELECT COUNT(*) AS n FROM finish_events').get().n;
    const backup = JSON.parse(JSON.stringify(exportBackup(db)));
    assert.equal(backup.version, 3);

    const target = createTestTournament({ teamCount: 2 });
    restoreBackup(target.db, backup);
    assert.equal(target.db.prepare('SELECT COUNT(*) AS n FROM finish_events').get().n, history);
    const line = getMatchDetail(target.db, 1).teams.find((team) => team.teamId === teams[1].id);
    assert.equal(line.finishCount, 1);
    assert.equal(getPlayerAudit(target.db, 1).teams.find((team) => team.teamId === teams[1].id)
      .players.find((entry) => entry.playerId === player.id).finishes, 1);
    assert.equal(eventId, target.eventId);
  });

  it('restores a version 1 backup by deriving team finish totals from the ledger', () => {
    const { db } = tournamentWithScores();
    const v2 = JSON.parse(JSON.stringify(exportBackup(db)));
    const v1 = structuredClone(v2);
    v1.version = 1;
    for (const row of v1.tables.team_match_results) {
      delete row.finish_count;
      delete row.finish_entered;
    }
    assert.deepEqual(validateBackup(v1), []);

    const target = createTestTournament({ teamCount: 2 });
    restoreBackup(target.db, v1);
    assert.deepEqual(computeStandings(target.db, 1), computeStandings(db, 1));
  });

  it('exports a backup that validates and survives a JSON round trip', () => {
    const { db } = tournamentWithScores();
    const backup = JSON.parse(JSON.stringify(exportBackup(db)));
    assert.deepEqual(validateBackup(backup), []);
  });

  it('restores the same standings into a different database', () => {
    const source = tournamentWithScores();
    const backup = JSON.parse(JSON.stringify(exportBackup(source.db)));

    const target = createTestTournament({ teamCount: 2 });
    restoreBackup(target.db, backup);

    assert.deepEqual(computeStandings(target.db, source.eventId), computeStandings(source.db, source.eventId));
    assert.equal(buildState(target.db, { mediaDirectory: os.tmpdir() }).mvp.playerId, buildState(source.db, { mediaDirectory: os.tmpdir() }).mvp.playerId);
  });

  it('rejects invalid backups before touching existing data', () => {
    const { db, eventId } = tournamentWithScores();
    const before = JSON.stringify(computeStandings(db, eventId));
    const goodBackup = JSON.parse(JSON.stringify(exportBackup(db)));

    const brokenReference = structuredClone(goodBackup);
    brokenReference.tables.players[0].team_id = 99999;
    const wrongFormat = { format: 'something-else', version: 1, tables: {} };
    const wrongVersion = { ...structuredClone(goodBackup), version: 99 };
    const badEnum = structuredClone(goodBackup);
    badEnum.tables.matches[0].status = 'archived';
    const badConfig = structuredClone(goodBackup);
    badConfig.tables.event_config[0].config_json = '{"scoring": {}}';

    for (const invalid of [brokenReference, wrongFormat, wrongVersion, badEnum, badConfig, null, 'text']) {
      assert.notEqual(validateBackup(invalid).length, 0);
      assertAppError(() => restoreBackup(db, invalid), 422, /not valid/);
    }
    assert.equal(JSON.stringify(computeStandings(db, eventId)), before);
    assert.equal(listTeams(db, eventId).length, 4);
  });
});
