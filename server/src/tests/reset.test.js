import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../app.js';
import { getBroadcastState, selectMvp, setCurrentMatch } from '../services/broadcastService.js';
import { listAuditEntries } from '../services/auditService.js';
import { recordElimination } from '../services/eliminationService.js';
import { exportBackup } from '../services/backupService.js';
import { resetScoringData } from '../services/resetService.js';
import { listPlayers, listTeams } from '../services/rosterService.js';
import { computeStandings } from '../services/standingsService.js';
import { computePlayerStats } from '../services/playerStatsService.js';
import { addTeamFinishes, adjustPlayer, createTestTournament, nextRequestId, placeTeamsInOrder, startNewMatch } from './testHelpers.js';
import { finalizeMatch, listMatches } from '../services/scoringService.js';

function populate() {
  const tournament = createTestTournament({ teamCount: 4, playersPerTeam: 2 });
  const { db, eventId, teams, playersByTeamId } = tournament;
  db.prepare('UPDATE teams SET logo_path = ? WHERE id = ?').run('/media/logos/x.png', teams[0].id);
  const first = startNewMatch(db, eventId);
  placeTeamsInOrder(db, first.id, teams);
  addTeamFinishes(db, first.id, teams[0].id, 3);
  adjustPlayer(db, first.id, playersByTeamId.get(teams[0].id)[0].id, 1, { teamId: teams[0].id });
  finalizeMatch(db, first.id);
  const second = startNewMatch(db, eventId);
  addTeamFinishes(db, second.id, teams[1].id, 2);
  recordElimination(db, second.id, { eliminatedTeamId: teams[2].id, creditedTeamId: teams[1].id, requestId: nextRequestId() });
  setCurrentMatch(db, second.id);
  selectMvp(db, eventId, playersByTeamId.get(teams[0].id)[0].id);
  db.prepare('UPDATE broadcast_state SET leaderboard_appearance = 3, scheduled_leaderboard_count = 2').run();
  return tournament;
}

describe('resetting scores', () => {
  it('removes all match data but keeps teams, players and logos', () => {
    const { db, eventId, teams } = populate();
    const teamsBefore = listTeams(db, eventId);
    const playersBefore = listPlayers(db, eventId);

    const removed = resetScoringData(db, eventId);

    assert.deepEqual(removed, { matches: 2, finishEvents: 1, eliminations: 1 });
    assert.deepEqual(listTeams(db, eventId).map((team) => [team.id, team.name, team.shortName, team.logoPath]),
      teamsBefore.map((team) => [team.id, team.name, team.shortName, team.logoPath]));
    assert.equal(listTeams(db, eventId).find((team) => team.id === teams[0].id).logoPath, '/media/logos/x.png');
    assert.deepEqual(listPlayers(db, eventId).map((player) => [player.id, player.name, player.teamId]),
      playersBefore.map((player) => [player.id, player.name, player.teamId]));
    for (const table of ['matches', 'team_match_results', 'finish_events', 'elimination_events', 'score_requests']) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, table);
    }
  });

  it('standings and player stats go back to zero, with every team still listed', () => {
    const { db, eventId, teams } = populate();
    resetScoringData(db, eventId);
    const standings = computeStandings(db, eventId);
    assert.equal(standings.length, teams.length);
    assert.ok(standings.every((row) => row.totalPoints === 0 && row.wwcd === 0 && row.finishCount === 0));
    assert.ok(computePlayerStats(db, eventId).every((player) => player.totalFinishes === 0));
    assert.deepEqual(listMatches(db, eventId), []);
  });

  it('clears the current match, the MVP and the page counters, but not the display settings', () => {
    const { db, eventId } = populate();
    db.prepare("UPDATE broadcast_state SET mode = 'standings', leaderboard_layout = 'scrolling', headline_text = 'Hello'").run();
    resetScoringData(db, eventId);
    const broadcast = getBroadcastState(db);
    assert.equal(broadcast.currentMatchId, null);
    assert.equal(broadcast.mvpPlayerId, null);
    assert.equal(broadcast.leaderboardAppearance, 0);
    assert.equal(db.prepare('SELECT scheduled_leaderboard_count AS n FROM broadcast_state').get().n, 0);
    assert.equal(broadcast.mode, 'standings');
    assert.equal(broadcast.leaderboardLayout, 'scrolling');
    assert.equal(broadcast.headlineText, 'Hello');
  });

  it('the next match starts again at match 1 and can be scored normally', () => {
    const { db, eventId, teams } = populate();
    resetScoringData(db, eventId);
    const match = startNewMatch(db, eventId);
    assert.equal(match.matchNumber, 1);
    addTeamFinishes(db, match.id, teams[3].id, 2);
    assert.equal(computeStandings(db, eventId).find((row) => row.teamId === teams[3].id).finishCount, 2);
  });

  it('is recorded in the audit log, and the old log entries stay', () => {
    const { db, eventId } = populate();
    const before = listAuditEntries(db, { limit: 500 }).length;
    resetScoringData(db, eventId);
    const entries = listAuditEntries(db, { limit: 500 });
    assert.equal(entries.length, before + 1);
    assert.equal(entries[0].action, 'tournament.reset_scores');
    assert.deepEqual(entries[0].details, { matches: 2, finishEvents: 1, eliminations: 1 });
  });

  it('works on a tournament with no matches yet', () => {
    const { db, eventId } = createTestTournament();
    assert.deepEqual(resetScoringData(db, eventId), { matches: 0, finishEvents: 0, eliminations: 0 });
  });

  it('a backup taken afterwards restores cleanly (the schema is still consistent)', () => {
    const { db, eventId } = populate();
    resetScoringData(db, eventId);
    const backup = exportBackup(db);
    assert.equal(backup.tables.matches.length, 0);
    assert.equal(backup.tables.teams.length, 4);
  });
});

describe('POST /api/event/reset-scores', () => {
  let server;
  let scheduler;
  let baseUrl;
  let directory;
  let tournament;

  before(async () => {
    tournament = populate();
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bgmi-reset-'));
    const config = {
      adminSecret: 'secret-1234',
      databasePath: path.join(directory, 'tournament.db'),
      repositoryRoot: directory,
      mediaDirectory: path.join(directory, 'media'),
      clientDistDirectory: path.join(directory, 'dist'),
    };
    ({ server, scheduler } = createApp({ db: tournament.db, config }));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    scheduler.stop();
    server.closeAllConnections();
    fs.rmSync(directory, { recursive: true, force: true });
    return new Promise((resolve) => server.close(resolve));
  });

  const post = async (body, secret = 'secret-1234') => {
    const response = await fetch(`${baseUrl}/api/event/reset-scores`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(secret ? { 'x-admin-secret': secret } : {}) },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };

  it('needs the admin secret', async () => {
    assert.equal((await post({ confirm: 'RESET' }, '')).status, 401);
  });

  it('refuses without the exact confirmation and changes nothing', async () => {
    for (const body of [{}, { confirm: true }, { confirm: 'reset' }]) {
      assert.equal((await post(body)).status, 400);
    }
    assert.equal(listMatches(tournament.db, tournament.eventId).length, 2);
    assert.equal(fs.existsSync(path.join(directory, 'backups')), false);
  });

  it('writes a restorable backup first, then resets and publishes the new state', async () => {
    const { status, body } = await post({ confirm: 'RESET' });
    assert.equal(status, 200);
    assert.deepEqual(body.removed, { matches: 2, finishEvents: 1, eliminations: 1 });
    assert.match(body.backupFile, /^backups[\\/]before-reset-.*\.json$/);

    const saved = JSON.parse(fs.readFileSync(path.join(directory, body.backupFile), 'utf8'));
    assert.equal(saved.tables.matches.length, 2); // the file holds the data from BEFORE the reset
    assert.equal(saved.tables.elimination_events.length, 1);
    assert.equal(listMatches(tournament.db, tournament.eventId).length, 0);
    assert.equal(listTeams(tournament.db, tournament.eventId).length, 4);

    const state = await (await fetch(`${baseUrl}/api/state`)).json();
    assert.equal(state.matches.length, 0);
    assert.equal(state.currentMatch, null);
    assert.equal(state.mvp, null);
    assert.equal(state.standings.length, 4);
  });
});
