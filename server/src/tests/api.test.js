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
    ({ server } = createApp({ db, config }));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
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

    const added = await call('POST', `/matches/${matchId}/finish-events`, { teamId, playerId, requestId: 'api-1' });
    assert.equal(added.status, 201);
    await waitFor(() => updates.length > updatesBefore);
    const latest = updates.at(-1);
    assert.equal(latest.standings.find((row) => row.teamId === teamId).finishPoints, 1);
    socket.close();
  });

  it('repeating a finish request does not add a second finish', async () => {
    const repeated = await call('POST', `/matches/${matchId}/finish-events`, { teamId, playerId, requestId: 'api-1' });
    assert.equal(repeated.status, 200);
    assert.equal(repeated.body.duplicate, true);
    const detail = await call('GET', `/matches/${matchId}`);
    assert.equal(detail.body.teams.find((team) => team.teamId === teamId).finishCount, 1);
  });

  it('an invalid score update is rejected and nothing is published', async () => {
    const { socket, updates } = connectClient();
    await waitFor(() => updates.length >= 1);
    const updatesBefore = updates.length;

    const rejected = await call('POST', `/matches/${matchId}/finish-events`, { teamId, playerId: 999999, requestId: 'api-bad' });
    assert.equal(rejected.status, 400);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(updates.length, updatesBefore);
    socket.close();
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
});
