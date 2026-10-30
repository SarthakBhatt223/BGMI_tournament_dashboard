// End-to-end tests of the HTTP API and Socket.IO. They need the npm dependencies
// (express, socket.io, socket.io-client), so run them after `npm install`.
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { io as connectSocket } from 'socket.io-client';
import { createApp } from '../app.js';
import { openDatabase } from '../db/database.js';
import { migrate } from '../db/migrate.js';
import { createPlayer, createTeam } from '../services/rosterService.js';

const ADMIN_SECRET = 'test-secret-123';

describe('HTTP API and Socket.IO', () => {
  let server;
  let scheduler;
  let baseUrl;
  let teamId;
  let playerId;
  let matchId;

  before(async () => {
    const db = openDatabase(':memory:');
    migrate(db);
    teamId = createTeam(db, 1, { name: 'API Team' }).id;
    createTeam(db, 1, { name: 'Other API Team' });
    playerId = createPlayer(db, { teamId, name: 'API Player' }).id;

    const config = {
      adminSecret: ADMIN_SECRET,
      mediaDirectory: path.join(os.tmpdir(), 'no-such-media-folder'),
      clientDistDirectory: path.join(os.tmpdir(), 'no-such-client-folder'),
    };
    ({ server, scheduler } = createApp({ db, config }));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    scheduler.stop();
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });

  async function call(method, route, body, { secret = ADMIN_SECRET } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (secret) headers['x-admin-secret'] = secret;
    const response = await fetch(`${baseUrl}/api${route}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  function connectClient() {
    const socket = connectSocket(baseUrl, { transports: ['websocket'], reconnection: false });
    const updates = [];
    socket.on('state:update', (state) => updates.push(state));
    return { socket, updates };
  }

  const waitFor = async (condition, timeoutMs = 2000) => {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };

  it('reports health without a secret', async () => {
    const { status, body } = await call('GET', '/health', undefined, { secret: '' });
    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.authRequired, true);
  });

  it('blocks changes and backups without the admin secret but allows public reads', async () => {
    assert.equal((await call('GET', '/standings', undefined, { secret: '' })).status, 200);
    assert.equal((await call('POST', '/matches', {}, { secret: '' })).status, 401);
    assert.equal((await call('POST', '/matches', {}, { secret: 'wrong' })).status, 401);
    assert.equal((await call('GET', '/backups/export', undefined, { secret: '' })).status, 401);
  });

  it('returns JSON errors for unknown routes and malformed bodies', async () => {
    const unknown = await call('GET', '/nothing-here');
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.error.code, 'not_found');

    const malformed = await fetch(`${baseUrl}/api/teams`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-secret': ADMIN_SECRET }, body: '{oops',
    });
    assert.equal(malformed.status, 400);
  });

  it('a successful score change reaches connected display clients', async () => {
    const created = await call('POST', '/matches', {});
    matchId = created.body.match.id;
    assert.equal((await call('POST', `/matches/${matchId}/start`)).status, 200);

    const { socket, updates } = connectClient();
    await waitFor(() => updates.length >= 1); // initial state on connect
    const updatesBefore = updates.length;

    const added = await call('POST', `/matches/${matchId}/teams/${teamId}/finishes`, { delta: 1, requestId: 'api-1' });
    assert.equal(added.status, 200);
    assert.equal(added.body.finishCount, 1);
    await waitFor(() => updates.length > updatesBefore);
    const latest = updates.at(-1);
    assert.equal(latest.standings.find((row) => row.teamId === teamId).finishPoints, 1);
    socket.close();
  });

  it('repeating a team finish request does not add a second finish', async () => {
    const repeated = await call('POST', `/matches/${matchId}/teams/${teamId}/finishes`, { delta: 1, requestId: 'api-1' });
    assert.equal(repeated.status, 200);
    assert.equal(repeated.body.duplicate, true);
    const detail = await call('GET', `/matches/${matchId}`);
    assert.equal(detail.body.teams.find((team) => team.teamId === teamId).finishCount, 1);
  });

  it('rejects a team finish below zero over HTTP', async () => {
    const otherTeam = (await call('GET', `/matches/${matchId}`)).body.teams.find((team) => team.teamId !== teamId);
    const rejected = await call('POST', `/matches/${matchId}/teams/${otherTeam.teamId}/finishes`, { delta: -1, requestId: 'api-neg' });
    assert.equal(rejected.status, 409);
    const detail = await call('GET', `/matches/${matchId}`);
    assert.equal(detail.body.teams.find((team) => team.teamId === otherTeam.teamId).finishCount, 0);
  });

  it('an invalid score update is rejected and nothing is published', async () => {
    const { socket, updates } = connectClient();
    await waitFor(() => updates.length >= 1);
    const updatesBefore = updates.length;

    const rejected = await call('POST', `/matches/${matchId}/players/999999/finishes`, { delta: 1, requestId: 'api-bad' });
    assert.equal(rejected.status, 400);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(updates.length, updatesBefore);
    socket.close();
  });

  it('player audit is admin-only, reconciles, and does not change team points', async () => {
    assert.equal((await call('GET', `/matches/${matchId}/player-audit`, undefined, { secret: '' })).status, 401);

    const before = await call('GET', `/matches/${matchId}/player-audit`);
    assert.equal(before.status, 200);
    const teamBefore = before.body.teams.find((team) => team.teamId === teamId);
    assert.equal(teamBefore.status, 'mismatch'); // team finishes 1, player total 0
    assert.equal(teamBefore.difference, 1);

    const { socket, updates } = connectClient();
    await waitFor(() => updates.length >= 1);
    const updatesBefore = updates.length;
    const added = await call('POST', `/matches/${matchId}/players/${playerId}/finishes`, { delta: 1, requestId: 'api-player-1' });
    assert.equal(added.status, 200);
    assert.equal(added.body.finishes, 1);
    assert.equal(added.body.audit.teams.find((team) => team.teamId === teamId).status, 'match');
    assert.equal(added.body.audit.summary.teamsReconciled, 1);

    await waitFor(() => updates.length > updatesBefore); // admin pages refresh from the broadcast
    // Display clients still see only the team total, counted once.
    assert.equal(updates.at(-1).standings.find((row) => row.teamId === teamId).finishPoints, 1);
    assert.equal(JSON.stringify(updates.at(-1)).includes('player-audit'), false);
    socket.close();

    const rejected = await call('POST', `/matches/${matchId}/players/${playerId}/finishes`, { delta: -1, requestId: 'api-player-2' });
    assert.equal(rejected.status, 200);
    const again = await call('POST', `/matches/${matchId}/players/${playerId}/finishes`, { delta: -1, requestId: 'api-player-3' });
    assert.equal(again.status, 409);
    // Restore the matching state for the rest of the file.
    await call('POST', `/matches/${matchId}/players/${playerId}/finishes`, { delta: 1, requestId: 'api-player-4' });
  });

  it('refuses to finalize an incomplete match and returns the reasons', async () => {
    const rejected = await call('POST', `/matches/${matchId}/finalize`);
    assert.equal(rejected.status, 422);
    assert.ok(rejected.body.error.details.length > 0);
    const detail = await call('GET', `/matches/${matchId}`);
    assert.equal(detail.body.match.status, 'in_progress');
  });

  it('a reconnecting client receives the current state immediately', async () => {
    await call('PUT', '/broadcast', { mode: 'standings', leaderboardLayout: 'scrolling' });
    const { socket, updates } = connectClient();
    await waitFor(() => updates.length >= 1);
    assert.equal(updates[0].broadcast.mode, 'standings');
    assert.equal(updates[0].broadcast.leaderboardLayout, 'scrolling');
    socket.close();
  });

  it('serves state with the ambient video reported as missing', async () => {
    const { body } = await call('GET', '/state', undefined, { secret: '' });
    assert.equal(body.media.ambientVideoAvailable, false);
  });

  it('exposes the leaderboard paging data and advances the page by hand', async () => {
    const { body } = await call('GET', '/state', undefined, { secret: '' });
    assert.equal(body.leaderboard.teamsPerPage, 10);
    assert.equal(body.leaderboard.pageCount, Math.ceil(body.leaderboard.teamCount / 10));

    const before = body.broadcast.leaderboardAppearance;
    const advanced = await call('PUT', '/broadcast', { advanceLeaderboardPage: true });
    assert.equal(advanced.status, 200);
    assert.equal(advanced.body.broadcast.leaderboardAppearance, before + 1);
    assert.equal((await call('PUT', '/broadcast', { advanceLeaderboardPage: 'x' })).status, 400);
  });

  it('exports a backup and refuses to restore without confirmation', async () => {
    const exported = await call('GET', '/backups/export');
    assert.equal(exported.status, 200);
    assert.equal(exported.body.format, 'bgmi-tournament-backup');

    const unconfirmed = await call('POST', '/backups/import', { backup: exported.body });
    assert.equal(unconfirmed.status, 400);
    const invalid = await call('POST', '/backups/import', { confirm: true, backup: { format: 'nope' } });
    assert.equal(invalid.status, 422);
    const restored = await call('POST', '/backups/import', { confirm: true, backup: exported.body });
    assert.equal(restored.status, 200);
  });

  // ---------- elimination events ----------

  const quiet = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

  async function otherTeamId() {
    const detail = await call('GET', `/matches/${matchId}`);
    return detail.body.teams.find((team) => team.teamId !== teamId).teamId;
  }

  it('records an elimination over HTTP and broadcasts it only after the commit', async () => {
    const otherId = await otherTeamId();
    const standingsBefore = (await call('GET', '/standings', undefined, { secret: '' })).body.standings;
    const { socket } = connectClient();
    const received = [];
    socket.on('elimination:new', (payload) => received.push(payload));
    await waitFor(() => socket.connected);

    const created = await call('POST', `/matches/${matchId}/eliminations`, {
      eliminatedTeamId: otherId, creditedTeamId: teamId, creditedPlayerId: playerId, requestId: 'elim-http-1', metadata: { zone: 'School' },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.duplicate, false);
    await waitFor(() => received.length === 1);

    const payload = received[0];
    assert.equal(payload.id, created.body.elimination.id);
    assert.equal(payload.eliminatedTeam.id, otherId);
    assert.equal(payload.eliminatedTeam.name, 'Other API Team');
    assert.equal(payload.creditedTeam.name, 'API Team');
    assert.ok('logoPath' in payload.creditedTeam);
    assert.equal(payload.creditedPlayer.name, 'API Player');
    assert.equal(payload.matchId, matchId);
    assert.ok(!Number.isNaN(Date.parse(payload.timestamp)));

    // The event was already committed when it was announced.
    const history = await call('GET', `/matches/${matchId}/eliminations`, undefined, { secret: '' });
    assert.equal(history.status, 200);
    assert.deepEqual(history.body.eliminations.map((entry) => entry.id), [payload.id]);

    // No scoring change at all.
    const standingsAfter = (await call('GET', '/standings', undefined, { secret: '' })).body.standings;
    assert.deepEqual(standingsAfter, standingsBefore);
    socket.close();
  });

  it('a retried elimination request creates and broadcasts nothing more', async () => {
    const otherId = await otherTeamId();
    const { socket } = connectClient();
    const received = [];
    socket.on('elimination:new', (payload) => received.push(payload));
    await waitFor(() => socket.connected);

    const retry = await call('POST', `/matches/${matchId}/eliminations`, {
      eliminatedTeamId: otherId, creditedTeamId: teamId, creditedPlayerId: playerId, requestId: 'elim-http-1',
    });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.duplicate, true);
    await quiet();
    assert.equal(received.length, 0);
    const history = await call('GET', `/matches/${matchId}/eliminations`, undefined, { secret: '' });
    assert.equal(history.body.eliminations.length, 1);
    socket.close();
  });

  it('rejects invalid elimination requests with clear errors and broadcasts nothing', async () => {
    const otherId = await otherTeamId();
    const { socket } = connectClient();
    const received = [];
    socket.on('elimination:new', (payload) => received.push(payload));
    await waitFor(() => socket.connected);
    const post = (body, route = `/matches/${matchId}/eliminations`) => call('POST', route, body);

    assert.equal((await post({ eliminatedTeamId: teamId, creditedTeamId: teamId, requestId: 'e1' })).status, 400);
    assert.equal((await post({ eliminatedTeamId: 999999, creditedTeamId: teamId, requestId: 'e2' })).status, 400);
    assert.equal((await post({ eliminatedTeamId: 'team_a', creditedTeamId: teamId, requestId: 'e3' })).status, 400);
    assert.equal((await post({ eliminatedTeamId: otherId, creditedTeamId: teamId })).status, 400);
    assert.equal((await post({ eliminatedTeamId: otherId, creditedTeamId: teamId, creditedPlayerId: 999999, requestId: 'e4' })).status, 400);
    assert.equal((await post({ eliminatedTeamId: otherId, creditedTeamId: teamId, requestId: 'e5' }, '/matches/999999/eliminations')).status, 404);
    const again = await post({ eliminatedTeamId: otherId, creditedTeamId: teamId, requestId: 'e6' }); // already eliminated
    assert.equal(again.status, 409);
    assert.equal((await post({ eliminatedTeamId: otherId, creditedTeamId: teamId, requestId: 'elim-http-1' })).status, 409); // same id, different request
    const unauthenticated = await call('POST', `/matches/${matchId}/eliminations`, { eliminatedTeamId: otherId, creditedTeamId: teamId, requestId: 'e7' }, { secret: '' });
    assert.equal(unauthenticated.status, 401);

    const planned = await call('POST', '/matches', {});
    const notStarted = await post({ eliminatedTeamId: otherId, creditedTeamId: teamId, requestId: 'e8' }, `/matches/${planned.body.match.id}/eliminations`);
    assert.equal(notStarted.status, 409);
    assert.match(notStarted.body.error.message, /not started/);

    await quiet();
    assert.equal(received.length, 0);
    socket.close();
  });

  it('voiding keeps the history', async () => {
    const history = await call('GET', `/matches/${matchId}/eliminations`, undefined, { secret: '' });
    const [first] = history.body.eliminations;
    const voided = await call('POST', `/matches/${matchId}/eliminations/${first.id}/void`, { reason: 'test' });
    assert.equal(voided.status, 200);
    assert.equal(voided.body.elimination.status, 'voided');
    const after = await call('GET', `/matches/${matchId}/eliminations`, undefined, { secret: '' });
    assert.deepEqual(after.body.eliminations.map((entry) => entry.status), ['voided']);
  });

  // ---------- scheduled leaderboard over a real socket ----------

  it('broadcasts a scheduled leaderboard, lets reconnecting displays recover it, and returns to ambient', async () => {
    const config = (await call('GET', '/event/config')).body.config;
    const changed = await call('PUT', '/event/config', {
      ...config, scheduledLeaderboard: { ...config.scheduledLeaderboard, leaderboardIntervalMs: 60000, leaderboardDisplayDurationMs: 1200 },
    });
    assert.equal(changed.status, 200);
    assert.equal((await call('PUT', '/broadcast', { mode: 'ambient' })).status, 200);
    scheduler.start();
    scheduler.start(); // idempotent
    assert.equal(scheduler.getStatus().intervalTimerArmed, true);

    const display = connectClient();
    const leaderboardEvents = [];
    const stateEvents = [];
    display.socket.on('broadcast:leaderboard', (payload) => leaderboardEvents.push(payload));
    display.socket.on('broadcast:state', (payload) => stateEvents.push(payload));
    await waitFor(() => display.updates.length >= 1);
    assert.equal(display.updates[0].broadcast.presentation, null);

    assert.ok(scheduler.triggerNow());
    await waitFor(() => leaderboardEvents.length === 1);
    const shown = leaderboardEvents[0];
    assert.equal(shown.type, 'scheduled_leaderboard');
    assert.equal(shown.page, 1);
    assert.equal(shown.totalPages, 1); // two teams in this test database
    assert.equal(shown.standings.length, 2);
    assert.equal(shown.displayDurationMs, 1200);
    assert.equal(stateEvents.at(-1).phase, 'leaderboard_started');
    await waitFor(() => display.updates.at(-1).broadcast.presentation !== null);

    // Displays that disconnect and reconnect mid-presentation recover it from the snapshot,
    // and reconnecting does not create more schedules.
    for (let reconnect = 0; reconnect < 5; reconnect += 1) {
      const again = connectClient();
      await waitFor(() => again.updates.length >= 1);
      assert.equal(again.updates[0].broadcast.presentation.presentationId, shown.presentationId);
      assert.equal(again.updates[0].broadcast.mode, 'ambient');
      again.socket.close();
    }
    assert.equal(scheduler.getStatus().intervalTimerArmed, true);

    await waitFor(() => stateEvents.some((entry) => entry.phase === 'returned_to_ambient'), 4000);
    await waitFor(() => display.updates.at(-1).broadcast.presentation === null);
    const state = await call('GET', '/state', undefined, { secret: '' });
    assert.equal(state.body.broadcast.mode, 'ambient');
    assert.equal(state.body.broadcast.presentation, null);
    display.socket.close();
  });

  it('a manual mode change cancels a scheduled leaderboard immediately and the schedule pauses', async () => {
    const display = connectClient();
    const stateEvents = [];
    display.socket.on('broadcast:state', (payload) => stateEvents.push(payload));
    await waitFor(() => display.updates.length >= 1);

    assert.ok(scheduler.triggerNow());
    await waitFor(() => display.updates.at(-1).broadcast.presentation !== null);

    const switched = await call('PUT', '/broadcast', { mode: 'mvp' });
    assert.equal(switched.status, 200);
    await waitFor(() => stateEvents.some((entry) => entry.phase === 'cancelled'));
    await waitFor(() => display.updates.at(-1).broadcast.presentation === null);
    assert.equal(display.updates.at(-1).broadcast.mode, 'mvp');
    assert.equal(scheduler.getStatus().intervalTimerArmed, false);
    assert.equal(scheduler.triggerNow(), null); // not allowed while the MVP is on screen

    await quiet(1500); // the old end timer must not fire
    assert.equal(stateEvents.some((entry) => entry.phase === 'returned_to_ambient'), false);
    assert.equal(display.updates.at(-1).broadcast.mode, 'mvp');

    assert.equal((await call('PUT', '/broadcast', { mode: 'ambient' })).status, 200);
    assert.equal(scheduler.getStatus().intervalTimerArmed, true);
    display.socket.close();
  });
});
