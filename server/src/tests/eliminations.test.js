import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { openDatabase } from '../db/database.js';
import { migrate } from '../db/migrate.js';
import { AppError } from '../errors.js';
import { exportBackup, restoreBackup, validateBackup } from '../services/backupService.js';
import { getEliminationEvent, listEliminations, recordElimination, voidElimination } from '../services/eliminationService.js';
import { getPlayerAudit } from '../services/playerAuditService.js';
import { computePlayerStats } from '../services/playerStatsService.js';
import { deletePlayer, deleteTeam, getTeam, updatePlayer } from '../services/rosterService.js';
import { finalizeMatch, getMatchDetail, createMatch } from '../services/scoringService.js';
import { computeStandings } from '../services/standingsService.js';
import { listAuditEntries } from '../services/auditService.js';
import { addTeamFinishes, adjustPlayer, createTestTournament, nextRequestId, placeTeamsInOrder, startNewMatch } from './testHelpers.js';

function assertAppError(work, status, messagePart) {
  assert.throws(work, (error) => {
    assert.ok(error instanceof AppError, `expected AppError, got ${error}`);
    assert.equal(error.status, status);
    if (messagePart) assert.match(error.message, messagePart);
    return true;
  });
}

function eliminate(db, matchId, eliminatedTeamId, creditedTeamId, extra = {}, options = {}) {
  return recordElimination(db, matchId, { eliminatedTeamId, creditedTeamId, requestId: nextRequestId(), ...extra }, options);
}

function setup(options) {
  const tournament = createTestTournament(options);
  const match = startNewMatch(tournament.db, tournament.eventId);
  return { ...tournament, match };
}

describe('recording elimination events', () => {
  it('stores a valid event with team names, logos and the operator', () => {
    const { db, teams, match } = setup();
    db.prepare('UPDATE teams SET logo_path = ? WHERE id = ?').run('/media/logos/team-b.png', teams[1].id);

    const { elimination, duplicate } = eliminate(db, match.id, teams[0].id, teams[1].id, { metadata: { zone: 'Pochinki' } }, { operator: 'Operator 1' });

    assert.equal(duplicate, false);
    assert.equal(elimination.status, 'active');
    assert.equal(elimination.matchId, match.id);
    assert.equal(elimination.matchNumber, match.matchNumber);
    assert.equal(elimination.eliminatedTeam.name, teams[0].name);
    assert.equal(elimination.creditedTeam.name, teams[1].name);
    assert.equal(elimination.creditedTeam.logoPath, '/media/logos/team-b.png');
    assert.equal(elimination.eliminatedTeam.logoPath, null);
    assert.equal(elimination.creditedPlayer, null);
    assert.equal(elimination.recordedBy, 'Operator 1');
    assert.deepEqual(elimination.metadata, { zone: 'Pochinki' });
    assert.ok(Number.isInteger(elimination.id));
    assert.ok(!Number.isNaN(Date.parse(elimination.createdAt)));
  });

  it('credits a player of the credited team', () => {
    const { db, teams, playersByTeamId, match } = setup();
    const [player] = playersByTeamId.get(teams[1].id);
    const { elimination } = eliminate(db, match.id, teams[0].id, teams[1].id, { creditedPlayerId: player.id });
    assert.deepEqual(elimination.creditedPlayer, { id: player.id, name: player.name, inGameName: player.inGameName ?? null });
  });

  it('writes an audit log entry', () => {
    const { db, teams, match } = setup();
    eliminate(db, match.id, teams[0].id, teams[1].id);
    assert.ok(listAuditEntries(db, { limit: 20 }).some((entry) => entry.action === 'elimination.record'));
  });
});

describe('elimination validation', () => {
  it('rejects an unknown team (400) and leaves nothing stored', () => {
    const { db, teams, match } = setup();
    assertAppError(() => eliminate(db, match.id, 9999, teams[1].id), 400, /Team 9999/);
    assertAppError(() => eliminate(db, match.id, teams[0].id, 9999), 400, /Team 9999/);
    assert.equal(listEliminations(db, match.id).length, 0);
  });

  it('rejects a team eliminating itself', () => {
    const { db, teams, match } = setup();
    assertAppError(() => eliminate(db, match.id, teams[0].id, teams[0].id), 400, /cannot be eliminated by itself/);
  });

  it('rejects an unknown match (404)', () => {
    const { db, teams } = setup();
    assertAppError(() => eliminate(db, 9999, teams[0].id, teams[1].id), 404, /Match 9999/);
    assertAppError(() => listEliminations(db, 9999), 404);
  });

  it('only accepts events for a match in progress', () => {
    const { db, eventId, teams, match } = setup();
    const planned = createMatch(db, eventId, {});
    assertAppError(() => eliminate(db, planned.id, teams[0].id, teams[1].id), 409, /not started/);

    placeTeamsInOrder(db, match.id, teams);
    finalizeMatch(db, match.id);
    assertAppError(() => eliminate(db, match.id, teams[0].id, teams[1].id), 409, /finalized/);
  });

  it('rejects a player who is not on the credited team, unknown, or inactive', () => {
    const { db, teams, playersByTeamId, match } = setup();
    const [playerOfTeamTwo] = playersByTeamId.get(teams[1].id);
    const [playerOfTeamThree] = playersByTeamId.get(teams[2].id);
    assertAppError(() => eliminate(db, match.id, teams[0].id, teams[1].id, { creditedPlayerId: playerOfTeamThree.id }), 400, /does not belong to the credited team/);
    // the eliminated team's own player cannot be credited either
    const [playerOfEliminated] = playersByTeamId.get(teams[0].id);
    assertAppError(() => eliminate(db, match.id, teams[0].id, teams[1].id, { creditedPlayerId: playerOfEliminated.id }), 400, /does not belong/);
    assertAppError(() => eliminate(db, match.id, teams[0].id, teams[1].id, { creditedPlayerId: 9999 }), 400, /Player 9999/);
    updatePlayer(db, playerOfTeamTwo.id, { active: false });
    assertAppError(() => eliminate(db, match.id, teams[0].id, teams[1].id, { creditedPlayerId: playerOfTeamTwo.id }), 400, /inactive/);
    assert.equal(listEliminations(db, match.id).length, 0);
  });

  it('rejects malformed requests', () => {
    const { db, teams, match } = setup();
    const valid = { eliminatedTeamId: teams[0].id, creditedTeamId: teams[1].id, requestId: 'ok-1' };
    const bad = [
      null, [], 'text',
      { ...valid, eliminatedTeamId: 'team_a' },
      { ...valid, creditedTeamId: '2' },
      { ...valid, eliminatedTeamId: 0 },
      { ...valid, eliminatedTeamId: 1.5 },
      { ...valid, creditedPlayerId: 'abc' },
      { ...valid, requestId: undefined },
      { ...valid, requestId: '   ' },
      { ...valid, requestId: 'x'.repeat(65) },
      { ...valid, metadata: 'text' },
      { ...valid, metadata: [] },
      { ...valid, metadata: { note: 'x'.repeat(3000) } },
    ];
    for (const input of bad) {
      assertAppError(() => recordElimination(db, match.id, input), 400);
    }
    assert.equal(listEliminations(db, match.id).length, 0);
  });

  it('rejects an inactive team', () => {
    const { db, teams, match } = setup();
    db.prepare('UPDATE teams SET active = 0 WHERE id = ?').run(teams[0].id);
    assertAppError(() => eliminate(db, match.id, teams[0].id, teams[1].id), 400, /inactive/);
  });
});

describe('duplicate requests', () => {
  it('a repeated requestId returns the first event and creates nothing', () => {
    const { db, teams, match } = setup();
    const request = { eliminatedTeamId: teams[0].id, creditedTeamId: teams[1].id, requestId: 'retry-me' };
    const first = recordElimination(db, match.id, request);
    const second = recordElimination(db, match.id, request);
    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(second.elimination.id, first.elimination.id);
    assert.equal(listEliminations(db, match.id).length, 1);
  });

  it('reusing a requestId for a different elimination is a conflict', () => {
    const { db, teams, match } = setup();
    recordElimination(db, match.id, { eliminatedTeamId: teams[0].id, creditedTeamId: teams[1].id, requestId: 'same-id' });
    assertAppError(
      () => recordElimination(db, match.id, { eliminatedTeamId: teams[2].id, creditedTeamId: teams[1].id, requestId: 'same-id' }),
      409,
      /different change/,
    );
  });

  it('a team can only be eliminated once per match, unless the first event is voided', () => {
    const { db, teams, match } = setup();
    const first = eliminate(db, match.id, teams[0].id, teams[1].id).elimination;
    assertAppError(() => eliminate(db, match.id, teams[0].id, teams[2].id), 409, /already eliminated/);
    assert.equal(listEliminations(db, match.id).length, 1);

    voidElimination(db, match.id, first.id, { reason: 'wrong team credited' });
    const again = eliminate(db, match.id, teams[0].id, teams[2].id).elimination;
    assert.notEqual(again.id, first.id);
    assert.equal(again.creditedTeam.id, teams[2].id);
  });

  it('a failed request does not use up its requestId', () => {
    const { db, teams, match } = setup();
    assertAppError(() => recordElimination(db, match.id, { eliminatedTeamId: teams[0].id, creditedTeamId: 9999, requestId: 'fix-me' }), 400);
    const { elimination } = recordElimination(db, match.id, { eliminatedTeamId: teams[0].id, creditedTeamId: teams[1].id, requestId: 'fix-me' });
    assert.ok(elimination.id);
  });
});

describe('history and persistence', () => {
  it('lists the history of one match, oldest first, including voided events', () => {
    const { db, eventId, teams, match } = setup();
    const first = eliminate(db, match.id, teams[0].id, teams[1].id).elimination;
    const second = eliminate(db, match.id, teams[2].id, teams[1].id).elimination;
    voidElimination(db, match.id, first.id, { reason: 'mistake' });

    const history = listEliminations(db, match.id);
    assert.deepEqual(history.map((entry) => [entry.id, entry.status]), [[first.id, 'voided'], [second.id, 'active']]);
    assert.equal(history[0].voidReason, 'mistake');
    assert.ok(history[0].voidedAt);

    // A different match has its own, separate history.
    finalizeAndStartNext(db, eventId, teams, match);
  });

  function finalizeAndStartNext(db, eventId, teams, match) {
    placeTeamsInOrder(db, match.id, teams);
    finalizeMatch(db, match.id);
    const next = startNewMatch(db, eventId);
    assert.deepEqual(listEliminations(db, next.id), []);
    assert.equal(listEliminations(db, match.id).length, 2);
  }

  it('survives closing and reopening the database file', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bgmi-elim-'));
    const databasePath = path.join(directory, 'tournament.db');
    const first = openDatabase(databasePath);
    migrate(first);
    // Build the roster directly so this test needs no in-memory helper.
    first.exec(`INSERT INTO teams (event_id, name) VALUES (1, 'Persist A'), (1, 'Persist B')`);
    first.exec(`INSERT INTO matches (event_id, match_number, status) VALUES (1, 1, 'in_progress')`);
    const [a, b] = first.prepare('SELECT id FROM teams ORDER BY id').all().map((row) => row.id);
    const { elimination } = recordElimination(first, 1, { eliminatedTeamId: a, creditedTeamId: b, requestId: 'persist-1' }, { operator: 'op' });
    first.close();

    const reopened = openDatabase(databasePath);
    migrate(reopened);
    const history = listEliminations(reopened, 1);
    assert.equal(history.length, 1);
    assert.equal(history[0].id, elimination.id);
    assert.equal(history[0].eliminatedTeam.name, 'Persist A');
    assert.equal(history[0].recordedBy, 'op');
    // The request id is remembered across restarts too, so a late retry is still harmless.
    assert.equal(recordElimination(reopened, 1, { eliminatedTeamId: a, creditedTeamId: b, requestId: 'persist-1' }).duplicate, true);
    reopened.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
});

describe('voiding', () => {
  it('voids an event once and never deletes the row', () => {
    const { db, teams, match } = setup();
    const { elimination } = eliminate(db, match.id, teams[0].id, teams[1].id);
    const voided = voidElimination(db, match.id, elimination.id, { reason: 'duplicate input' }).elimination;
    assert.equal(voided.status, 'voided');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM elimination_events').get().n, 1);
    assertAppError(() => voidElimination(db, match.id, elimination.id, {}), 409, /already voided/);
  });

  it('rejects unknown events, events of another match and finalized matches', () => {
    const { db, eventId, teams, match } = setup();
    const { elimination } = eliminate(db, match.id, teams[0].id, teams[1].id);
    assertAppError(() => voidElimination(db, match.id, 9999, {}), 404);
    placeTeamsInOrder(db, match.id, teams);
    finalizeMatch(db, match.id);
    assertAppError(() => voidElimination(db, match.id, elimination.id, {}), 409, /finalized/);
    const next = startNewMatch(db, eventId);
    assertAppError(() => voidElimination(db, next.id, elimination.id, {}), 404, /does not belong/);
  });
});

describe('elimination events never change scoring', () => {
  function scoringSnapshot(db, eventId, matchId) {
    return JSON.stringify({
      standings: computeStandings(db, eventId),
      detail: getMatchDetail(db, matchId),
      playerStats: computePlayerStats(db, eventId),
      audit: { ...getPlayerAudit(db, matchId), generatedAt: null },
      finishEvents: db.prepare('SELECT * FROM finish_events').all(),
      results: db.prepare('SELECT * FROM team_match_results').all(),
    });
  }

  it('leaves finishes, points, standings and player stats exactly as they were', () => {
    const { db, eventId, teams, playersByTeamId, match } = setup();
    addTeamFinishes(db, match.id, teams[1].id, 2);
    adjustPlayer(db, match.id, playersByTeamId.get(teams[1].id)[0].id);
    const before = scoringSnapshot(db, eventId, match.id);

    const [creditedPlayer] = playersByTeamId.get(teams[1].id);
    eliminate(db, match.id, teams[0].id, teams[1].id, { creditedPlayerId: creditedPlayer.id });
    eliminate(db, match.id, teams[2].id, teams[1].id);

    assert.equal(scoringSnapshot(db, eventId, match.id), before);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM finish_events').get().n, 1); // only the player finish added above
  });

  it('a finish recorded separately is counted once, not once more for the elimination', () => {
    const { db, eventId, teams, match } = setup();
    eliminate(db, match.id, teams[0].id, teams[1].id);
    assert.equal(computeStandings(db, eventId).find((row) => row.teamId === teams[1].id).finishCount, 0);
    addTeamFinishes(db, match.id, teams[1].id, 1); // the operator records the finish
    const row = computeStandings(db, eventId).find((entry) => entry.teamId === teams[1].id);
    assert.equal(row.finishCount, 1);
    assert.equal(row.finishPoints, 1);
    assert.equal(getMatchDetail(db, match.id).teams.find((team) => team.teamId === teams[1].id).finishCount, 1);
  });
});

describe('history protection and backups', () => {
  it('a team or player with elimination history cannot be deleted', () => {
    const { db, teams, playersByTeamId, match } = setup();
    const [player] = playersByTeamId.get(teams[1].id);
    eliminate(db, match.id, teams[0].id, teams[1].id, { creditedPlayerId: player.id });
    assert.equal(getTeam(db, teams[0].id).hasHistory, true);
    assert.equal(getTeam(db, teams[1].id).hasHistory, true);
    assertAppError(() => deleteTeam(db, teams[0].id), 409);
    assertAppError(() => deleteTeam(db, teams[1].id), 409);
    assertAppError(() => deletePlayer(db, player.id), 409, /finishes or eliminations/);
  });

  it('a backup keeps the elimination history, including voided events', () => {
    const { db, teams, match } = setup();
    const first = eliminate(db, match.id, teams[0].id, teams[1].id).elimination;
    eliminate(db, match.id, teams[2].id, teams[1].id);
    voidElimination(db, match.id, first.id, { reason: 'x' });
    const backup = JSON.parse(JSON.stringify(exportBackup(db)));
    assert.equal(backup.version, 3);
    assert.deepEqual(validateBackup(backup), []);

    const target = createTestTournament({ teamCount: 2 });
    restoreBackup(target.db, backup);
    assert.deepEqual(
      listEliminations(target.db, match.id).map((entry) => [entry.id, entry.status]),
      listEliminations(db, match.id).map((entry) => [entry.id, entry.status]),
    );
    assert.equal(getEliminationEvent(target.db, first.id).voidReason, 'x');
  });

  it('a backup made before elimination events existed still restores (with none)', () => {
    const { db } = setup();
    const backup = JSON.parse(JSON.stringify(exportBackup(db)));
    delete backup.tables.elimination_events;
    for (const row of backup.tables.broadcast_state) delete row.scheduled_leaderboard_count;
    backup.version = 2;
    assert.deepEqual(validateBackup(backup), []);

    const target = setup({ teamCount: 3 });
    eliminate(target.db, target.match.id, target.teams[0].id, target.teams[1].id);
    restoreBackup(target.db, backup);
    assert.equal(target.db.prepare('SELECT COUNT(*) AS n FROM elimination_events').get().n, 0);
  });

  it('rejects a backup with two active eliminations of the same team in one match', () => {
    const { db, teams, match } = setup();
    eliminate(db, match.id, teams[0].id, teams[1].id);
    const backup = JSON.parse(JSON.stringify(exportBackup(db)));
    backup.tables.elimination_events.push({ ...backup.tables.elimination_events[0], id: 99 });
    assert.ok(validateBackup(backup).some((problem) => /duplicate/.test(problem)));
  });
});
