import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
// Pure display logic from the client, tested here because the client has no test runner.
import { enqueueElimination, noticeDuration } from '../../../client/src/utils/eliminationQueue.js';
import { sceneOf } from '../../../client/src/utils/displayScene.js';
import { playerInitials } from '../../../client/src/utils/formatters.js';
import { pickNewerSnapshot } from '../../../client/src/utils/snapshotOrder.js';

describe('pickNewerSnapshot', () => {
  const older = { generatedAt: '2026-10-31T10:00:00.000Z', tag: 'older' };
  const newer = { generatedAt: '2026-10-31T10:00:05.000Z', tag: 'newer' };
  it('keeps the newer snapshot when an older one arrives late', () => {
    assert.equal(pickNewerSnapshot(newer, older), newer);
  });
  it('accepts a newer or equal snapshot, and the first one', () => {
    assert.equal(pickNewerSnapshot(older, newer), newer);
    assert.equal(pickNewerSnapshot(null, older), older);
    assert.equal(pickNewerSnapshot(older, { ...older, tag: 'same' }).tag, 'same');
  });
  it('ignores an empty incoming snapshot and accepts one with an unreadable time', () => {
    assert.equal(pickNewerSnapshot(older, null), older);
    assert.equal(pickNewerSnapshot(older, { generatedAt: 'bad' }).generatedAt, 'bad');
  });
});

describe('elimination queue', () => {
  it('keeps every event in arrival order, however many arrive', () => {
    let state = { queue: [], seenIds: new Set() };
    for (let id = 1; id <= 30; id += 1) state = enqueueElimination(state.queue, state.seenIds, { id, status: 'active' });
    assert.deepEqual(state.queue.map((event) => event.id), Array.from({ length: 30 }, (_, i) => i + 1));
  });
  it('queues an event once and skips voided or malformed ones', () => {
    let state = enqueueElimination([], new Set(), { id: 7, status: 'active' });
    state = enqueueElimination(state.queue, state.seenIds, { id: 7, status: 'active' });
    state = enqueueElimination(state.queue, state.seenIds, { id: 8, status: 'voided' });
    state = enqueueElimination(state.queue, state.seenIds, null);
    assert.equal(state.queue.length, 1);
  });
  it('shortens alerts only when several are waiting, never below the minimum', () => {
    assert.equal(noticeDuration(0), 6000);
    assert.equal(noticeDuration(2), 6000);
    assert.ok(noticeDuration(4) < 6000);
    assert.equal(noticeDuration(50), 3500);
  });
});

describe('display helpers', () => {
  it('falls back to ambient for a missing or unknown broadcast mode', () => {
    assert.equal(sceneOf(null), 'ambient');
    assert.equal(sceneOf({ broadcast: { mode: 'weird' } }), 'ambient');
    assert.equal(sceneOf({ broadcast: { mode: 'mvp' } }), 'mvp');
  });
  it('builds initials for the MVP placeholder', () => {
    assert.equal(playerInitials('Rahul Verma'), 'RV');
    assert.equal(playerInitials('Sniper'), 'SN');
    assert.equal(playerInitials('  '), '?');
    assert.equal(playerInitials(undefined), '?');
  });
});
