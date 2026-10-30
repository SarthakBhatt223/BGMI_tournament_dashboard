import assert from 'node:assert/strict';
import os from 'node:os';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { AppError } from '../errors.js';
import { updateBroadcastState } from '../services/broadcastService.js';
import { getTournamentConfig, validateTournamentConfig, updateTournamentConfig } from '../services/eventService.js';
import { createLeaderboardScheduler } from '../services/leaderboardScheduler.js';
import { computeStandings } from '../services/standingsService.js';
import { buildState } from '../services/stateService.js';
import { updateEvent } from '../services/eventService.js';
import { addTeamFinishes, createTestTournament, startNewMatch } from './testHelpers.js';

const INTERVAL = 300000;
const DURATION = 15000;

beforeEach(() => mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_700_000_000_000 }));
afterEach(() => mock.timers.reset());

function changeSchedule(db, eventId, changes) {
  const config = getTournamentConfig(db, eventId);
  return updateTournamentConfig(db, eventId, { ...config, scheduledLeaderboard: { ...config.scheduledLeaderboard, ...changes } });
}

// A scheduler wired like createApp does it, with the socket and the publisher replaced by recorders.
function fixture(options = {}) {
  const tournament = createTestTournament({ teamCount: options.teamCount ?? 18, playersPerTeam: 1 });
  const { db, eventId } = tournament;
  const emitted = [];
  const published = [];
  const logged = [];
  const scheduler = createLeaderboardScheduler({
    db,
    publish: () => published.push(buildState(db, { mediaDirectory: os.tmpdir(), getPresentation: () => scheduler.getPresentation() })),
    emit: (event, payload) => emitted.push({ event, payload }),
    logError: (...args) => logged.push(args),
  });
  const eventsNamed = (name) => emitted.filter((entry) => entry.event === name).map((entry) => entry.payload);
  const leaderboards = () => eventsNamed('broadcast:leaderboard');
  const states = (phase) => eventsNamed('broadcast:state').filter((payload) => payload.phase === phase);
  // What createApp does on every committed broadcast change.
  const setBroadcast = (changes) => {
    updateBroadcastState(db, eventId, changes);
    scheduler.handleManualBroadcastChange(changes);
  };
  return { ...tournament, scheduler, emitted, published, logged, eventsNamed, leaderboards, states, setBroadcast };
}

const tick = (ms) => mock.timers.tick(ms);
// Node's fake timers run only the first due timer per tick() call (timers re-armed inside a
// callback are scheduled from the end of the tick), so step through several intervals one by one.
const advance = (ms, steps) => { for (let step = 0; step < steps; step += 1) mock.timers.tick(ms); };

describe('schedule timing', () => {
  it('shows nothing before the interval and exactly one leaderboard when it elapses', () => {
    const { scheduler, leaderboards } = fixture();
    scheduler.start();
    tick(INTERVAL - 1);
    assert.equal(leaderboards().length, 0);
    tick(1);
    assert.equal(leaderboards().length, 1);
    scheduler.stop();
  });

  it('defaults: every 5 minutes, 15 seconds on screen, 9 teams per page, enabled', () => {
    const { db, eventId } = fixture();
    assert.deepEqual(getTournamentConfig(db, eventId).scheduledLeaderboard, {
      enabled: true, leaderboardIntervalMs: 300000, leaderboardDisplayDurationMs: 15000, teamsPerPage: 9,
    });
  });

  it('repeats on a fixed cadence, one appearance per interval', () => {
    const { scheduler, leaderboards } = fixture();
    scheduler.start();
    advance(INTERVAL, 4);
    assert.equal(leaderboards().length, 4);
    assert.deepEqual(leaderboards().map((entry) => Date.parse(entry.startedAt)), [1, 2, 3, 4].map((n) => 1_700_000_000_000 + n * INTERVAL));
    scheduler.stop();
  });

  it('uses a configured interval and duration', () => {
    const { db, eventId, scheduler, leaderboards, states } = fixture();
    changeSchedule(db, eventId, { leaderboardIntervalMs: 60000, leaderboardDisplayDurationMs: 5000 });
    scheduler.start();
    tick(59999);
    assert.equal(leaderboards().length, 0);
    tick(1);
    assert.equal(leaderboards()[0].displayDurationMs, 5000);
    tick(4999);
    assert.equal(states('returned_to_ambient').length, 0);
    tick(1);
    assert.equal(states('returned_to_ambient').length, 1);
    scheduler.stop();
  });

  it('does nothing when disabled, and starts when it is enabled again', () => {
    const { db, eventId, scheduler, leaderboards } = fixture();
    changeSchedule(db, eventId, { enabled: false });
    scheduler.start();
    assert.equal(scheduler.getStatus().intervalTimerArmed, false);
    tick(INTERVAL * 3);
    assert.equal(leaderboards().length, 0);

    changeSchedule(db, eventId, { enabled: true });
    scheduler.evaluate();
    assert.equal(scheduler.getStatus().intervalTimerArmed, true);
    tick(INTERVAL);
    assert.equal(leaderboards().length, 1);
    scheduler.stop();
  });

  it('re-arms with the new interval when the setting changes', () => {
    const { db, eventId, scheduler, leaderboards } = fixture();
    scheduler.start();
    tick(100000);
    changeSchedule(db, eventId, { leaderboardIntervalMs: 30000 });
    scheduler.evaluate();
    tick(29999);
    assert.equal(leaderboards().length, 0);
    tick(1);
    assert.equal(leaderboards().length, 1);
    scheduler.stop();
  });

  it('is off once the event is completed', () => {
    const { db, scheduler, leaderboards } = fixture();
    updateEvent(db, { status: 'completed' });
    scheduler.start();
    tick(INTERVAL * 2);
    assert.equal(leaderboards().length, 0);
    scheduler.stop();
  });
});

describe('pagination of the scheduled leaderboard', () => {
  it('18 teams: page 1 is ranks 1-9, page 2 is ranks 10-18, and they alternate', () => {
    const { scheduler, leaderboards } = fixture({ teamCount: 18 });
    scheduler.start();
    advance(INTERVAL, 5);
    const shown = leaderboards();
    assert.deepEqual(shown.map((entry) => entry.page), [1, 2, 1, 2, 1]);
    assert.ok(shown.every((entry) => entry.totalPages === 2 && entry.teamsPerPage === 9 && entry.standings.length === 9));
    assert.deepEqual(shown[0].standings.map((row) => row.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.deepEqual(shown[1].standings.map((row) => row.rank), [10, 11, 12, 13, 14, 15, 16, 17, 18]);
    scheduler.stop();
  });

  it('builds the number of pages from the real team count, without empty pages', () => {
    for (const [teams, pages] of [[1, [1]], [5, [5]], [9, [9]], [10, [9, 1]], [18, [9, 9]], [20, [9, 9, 2]], [27, [9, 9, 9]], [28, [9, 9, 9, 1]]]) {
      const { scheduler, leaderboards } = fixture({ teamCount: teams });
      scheduler.start();
      advance(INTERVAL, pages.length);
      assert.deepEqual(leaderboards().map((entry) => entry.standings.length), pages, `${teams} teams`);
      assert.ok(leaderboards().every((entry) => entry.totalPages === pages.length));
      assert.deepEqual(leaderboards().flatMap((entry) => entry.standings.map((row) => row.rank)), Array.from({ length: teams }, (_, i) => i + 1));
      scheduler.stop();
      mock.timers.reset();
      mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_700_000_000_000 });
    }
  });

  it('respects a configured teamsPerPage', () => {
    const { db, eventId, scheduler, leaderboards } = fixture({ teamCount: 18 });
    changeSchedule(db, eventId, { teamsPerPage: 6 });
    scheduler.start();
    advance(INTERVAL, 3);
    assert.deepEqual(leaderboards().map((entry) => [entry.page, entry.totalPages, entry.standings.length]), [[1, 3, 6], [2, 3, 6], [3, 3, 6]]);
    scheduler.stop();
  });

  it('shows no leaderboard (and keeps the schedule) when there are no teams', () => {
    const { scheduler, leaderboards, logged } = fixture({ teamCount: 0 });
    scheduler.start();
    tick(INTERVAL * 2);
    assert.equal(leaderboards().length, 0);
    assert.equal(scheduler.getStatus().intervalTimerArmed, true);
    assert.deepEqual(logged, []);
    scheduler.stop();
  });
});

describe('leaderboard data', () => {
  it('lists the fields, in the official ranking order, with team logos', () => {
    const { db, eventId, teams, scheduler, leaderboards } = fixture({ teamCount: 18 });
    db.prepare('UPDATE teams SET logo_path = ? WHERE id = ?').run('/media/logos/t12.png', teams[11].id);
    const match = startNewMatch(db, eventId);
    addTeamFinishes(db, match.id, teams[11].id, 4);
    addTeamFinishes(db, match.id, teams[5].id, 2);
    scheduler.start();
    tick(INTERVAL);

    const official = computeStandings(db, eventId);
    const [first] = leaderboards();
    assert.deepEqual(first.standings.map((row) => row.teamId), official.slice(0, 9).map((row) => row.teamId));
    assert.equal(first.standings[0].teamId, teams[11].id);
    assert.deepEqual(
      { rank: first.standings[0].rank, name: first.standings[0].name, logoPath: first.standings[0].logoPath, finishCount: first.standings[0].finishCount, placementPoints: first.standings[0].placementPoints, totalPoints: first.standings[0].totalPoints },
      { rank: 1, name: teams[11].name, logoPath: '/media/logos/t12.png', finishCount: 4, placementPoints: 0, totalPoints: 4 },
    );
    assert.deepEqual(Object.keys(first.standings[0]).sort(), ['finishCount', 'finishPoints', 'logoPath', 'name', 'placementPoints', 'rank', 'shortName', 'teamId', 'totalPoints', 'wwcd']);
    scheduler.stop();
  });

  it('uses the latest standings at the moment of each appearance', () => {
    const { db, eventId, teams, scheduler, leaderboards } = fixture({ teamCount: 10 });
    changeSchedule(db, eventId, { teamsPerPage: 10 });
    const match = startNewMatch(db, eventId);
    scheduler.start();
    addTeamFinishes(db, match.id, teams[2].id, 3);
    tick(INTERVAL);
    assert.equal(leaderboards()[0].standings[0].teamId, teams[2].id);

    addTeamFinishes(db, match.id, teams[7].id, 9); // standings change between appearances
    tick(INTERVAL);
    assert.equal(leaderboards()[1].standings[0].teamId, teams[7].id);
    assert.equal(leaderboards()[1].standings[0].totalPoints, 9);
    scheduler.stop();
  });

  it('describes the presentation: reason, page, page count, duration and end time', () => {
    const { scheduler, leaderboards } = fixture();
    scheduler.start();
    tick(INTERVAL);
    const [shown] = leaderboards();
    assert.equal(shown.type, 'scheduled_leaderboard');
    assert.equal(shown.reason, 'scheduled_interval');
    assert.equal(shown.returnToMode, 'ambient');
    assert.equal(shown.displayDurationMs, DURATION);
    assert.equal(Date.parse(shown.endsAt) - Date.parse(shown.startedAt), DURATION);
    assert.ok(!Number.isNaN(Date.parse(shown.timestamp)));
    assert.ok(shown.presentationId);
    scheduler.stop();
  });
});

describe('returning to ambient', () => {
  it('goes back to ambient after the display duration and keeps the schedule going', () => {
    const { db, scheduler, published, states, leaderboards } = fixture();
    scheduler.start();
    tick(INTERVAL);
    assert.ok(scheduler.getPresentation());
    assert.equal(published.at(-1).broadcast.presentation.page, 1);

    tick(DURATION - 1);
    assert.ok(scheduler.getPresentation());
    tick(1);
    assert.equal(scheduler.getPresentation(), null);
    assert.equal(states('leaderboard_started').length, 1);
    assert.equal(states('returned_to_ambient').length, 1);
    assert.equal(published.at(-1).broadcast.presentation, null);
    assert.equal(db.prepare('SELECT mode FROM broadcast_state').get().mode, 'ambient'); // never changed
    assert.equal(scheduler.getStatus().presentationTimerArmed, false);

    tick(INTERVAL - DURATION); // next appearance is one interval after the previous start
    assert.equal(leaderboards().length, 2);
    scheduler.stop();
  });

  it('publishes the state and persists the counter before announcing', () => {
    const { db, scheduler } = fixture();
    const seen = [];
    const original = scheduler;
    const checked = createLeaderboardScheduler({
      db,
      publish: () => seen.push(['publish', db.prepare('SELECT scheduled_leaderboard_count AS n FROM broadcast_state').get().n]),
      emit: (event) => seen.push([event, db.prepare('SELECT scheduled_leaderboard_count AS n FROM broadcast_state').get().n]),
    });
    original.stop();
    checked.start();
    tick(INTERVAL);
    assert.deepEqual(seen.slice(0, 3), [['publish', 1], ['broadcast:leaderboard', 1], ['broadcast:state', 1]]);
    checked.stop();
  });
});

describe('manual priority and pausing', () => {
  it('stops scheduling outside ambient mode and resumes with a fresh countdown', () => {
    const { scheduler, leaderboards, setBroadcast } = fixture();
    scheduler.start();
    tick(INTERVAL - 1000);
    setBroadcast({ mode: 'standings', leaderboardLayout: 'full' }); // operator: full leaderboard
    assert.equal(scheduler.getStatus().intervalTimerArmed, false);
    tick(INTERVAL * 3);
    assert.equal(leaderboards().length, 0);

    setBroadcast({ mode: 'ambient' });
    assert.equal(scheduler.getStatus().intervalTimerArmed, true);
    tick(INTERVAL - 1);
    assert.equal(leaderboards().length, 0);
    tick(1);
    assert.equal(leaderboards().length, 1);
    scheduler.stop();
  });

  it('never interrupts the MVP view', () => {
    const { scheduler, leaderboards, setBroadcast } = fixture();
    scheduler.start();
    setBroadcast({ mode: 'mvp' });
    tick(INTERVAL * 4);
    assert.equal(leaderboards().length, 0);
    assert.equal(scheduler.getPresentation(), null);
    scheduler.stop();
  });

  it('a manual mode change cancels a presentation in progress and its timers', () => {
    const { db, scheduler, states, leaderboards, published, setBroadcast } = fixture();
    scheduler.start();
    tick(INTERVAL);
    assert.ok(scheduler.getPresentation());

    setBroadcast({ mode: 'mvp' });
    assert.equal(scheduler.getPresentation(), null);
    assert.equal(states('cancelled').length, 1);
    assert.equal(states('cancelled')[0].reason, 'manual_mode_change');
    assert.deepEqual(scheduler.getStatus(), { started: true, intervalTimerArmed: false, presentationTimerArmed: false, presentationActive: false, nextRunAt: null });

    tick(INTERVAL * 2);
    assert.equal(states('returned_to_ambient').length, 0); // the old end timer is gone
    assert.equal(leaderboards().length, 1);
    assert.equal(db.prepare('SELECT mode FROM broadcast_state').get().mode, 'mvp'); // the operator's choice stays
    assert.ok(published.length >= 1);
    scheduler.stop();
  });

  it('selecting AMBIENT while a presentation is showing dismisses it', () => {
    const { scheduler, states, setBroadcast } = fixture();
    scheduler.start();
    tick(INTERVAL);
    setBroadcast({ mode: 'ambient' });
    assert.equal(scheduler.getPresentation(), null);
    assert.equal(states('cancelled').length, 1);
    assert.equal(scheduler.getStatus().intervalTimerArmed, true);
    scheduler.stop();
  });

  it('changing only the headline or layout does not cancel a presentation', () => {
    const { scheduler, setBroadcast } = fixture();
    scheduler.start();
    tick(INTERVAL);
    setBroadcast({ headlineText: 'Finals tonight' });
    setBroadcast({ leaderboardLayout: 'full' });
    assert.ok(scheduler.getPresentation());
    scheduler.stop();
  });

  it('turning the feature off during a presentation cancels it', () => {
    const { db, eventId, scheduler, states } = fixture();
    scheduler.start();
    tick(INTERVAL);
    changeSchedule(db, eventId, { enabled: false });
    scheduler.evaluate();
    assert.equal(scheduler.getPresentation(), null);
    assert.equal(states('cancelled')[0].reason, 'disabled');
    scheduler.stop();
  });
});

describe('timer reliability', () => {
  it('start() and evaluate() are safe to call repeatedly (reconnects): one schedule only', () => {
    const { scheduler, leaderboards } = fixture();
    for (let reconnect = 0; reconnect < 25; reconnect += 1) {
      scheduler.start();
      scheduler.evaluate();
    }
    advance(INTERVAL, 3);
    assert.equal(leaderboards().length, 3);
    scheduler.stop();
  });

  it('a second scheduler instance on the same server would be visible; one instance never doubles up', () => {
    const { scheduler, leaderboards } = fixture();
    scheduler.start();
    tick(INTERVAL);
    scheduler.start();
    scheduler.evaluate();
    tick(INTERVAL);
    scheduler.evaluate();
    tick(INTERVAL);
    assert.equal(leaderboards().length, 3);
    assert.deepEqual(leaderboards().map((entry) => entry.presentationId), ['leaderboard-1', 'leaderboard-2', 'leaderboard-3']);
    scheduler.stop();
  });

  it('never has more than one interval timer and one presentation timer', () => {
    const tournament = createTestTournament({ teamCount: 18, playersPerTeam: 1 });
    let active = 0;
    let highest = 0;
    const timers = new Set();
    const scheduler = createLeaderboardScheduler({
      db: tournament.db,
      publish: () => {},
      emit: () => {},
      setTimer: (callback, ms) => {
        const timer = globalThis.setTimeout(() => { timers.delete(timer); active = timers.size; callback(); }, ms);
        timers.add(timer);
        active = timers.size;
        highest = Math.max(highest, active);
        return timer;
      },
      clearTimer: (timer) => { timers.delete(timer); active = timers.size; globalThis.clearTimeout(timer); },
    });
    scheduler.start();
    for (let i = 0; i < 40; i += 1) {
      scheduler.evaluate();
      tick(60000);
    }
    assert.ok(highest <= 2, `at most an interval timer and a presentation timer, saw ${highest}`);
    scheduler.stop();
    assert.equal(timers.size, 0);
  });

  it('stop() clears every timer: nothing fires afterwards', () => {
    const { scheduler, leaderboards, states } = fixture();
    scheduler.start();
    tick(INTERVAL);
    scheduler.stop();
    assert.deepEqual(scheduler.getStatus(), { started: false, intervalTimerArmed: false, presentationTimerArmed: false, presentationActive: false, nextRunAt: null });
    tick(INTERVAL * 3);
    assert.equal(leaderboards().length, 1);
    assert.equal(states('returned_to_ambient').length, 0);
  });

  it('never shows two presentations at once', () => {
    const { scheduler, leaderboards } = fixture();
    scheduler.start();
    assert.ok(scheduler.triggerNow());
    assert.equal(scheduler.triggerNow(), null);
    assert.equal(leaderboards().length, 1);
    scheduler.stop();
  });

  it('a failing socket or publisher does not break the schedule', () => {
    const tournament = createTestTournament({ teamCount: 18, playersPerTeam: 1 });
    const logged = [];
    const scheduler = createLeaderboardScheduler({
      db: tournament.db,
      publish: () => { throw new Error('publish failed'); },
      emit: () => { throw new Error('socket exploded'); },
      logError: (...args) => logged.push(args),
    });
    scheduler.start();
    tick(INTERVAL);
    assert.ok(logged.length >= 2);
    tick(DURATION);
    assert.equal(scheduler.getPresentation(), null); // still returned to ambient
    tick(INTERVAL);
    assert.ok(scheduler.getPresentation()); // and keeps going
    scheduler.stop();
  });
});

describe('restart safety', () => {
  it('starts a fresh countdown after a restart and never replays missed appearances', () => {
    const { db, scheduler, leaderboards } = fixture();
    scheduler.start();
    advance(INTERVAL, 2);
    assert.equal(leaderboards().length, 2);
    scheduler.stop(); // server goes down

    tick(INTERVAL * 6); // an hour-long outage: nothing runs
    const emitted = [];
    const restarted = createLeaderboardScheduler({ db, publish: () => {}, emit: (event, payload) => emitted.push({ event, payload }) });
    restarted.start();
    assert.equal(emitted.length, 0); // nothing fires on start
    assert.equal(restarted.getPresentation(), null);

    tick(INTERVAL - 1);
    assert.equal(emitted.length, 0);
    tick(1);
    const appearances = emitted.filter((entry) => entry.event === 'broadcast:leaderboard');
    assert.equal(appearances.length, 1); // exactly one, not three
    assert.equal(appearances[0].payload.page, 1); // pages continue alternating: 1, 2, then 1 again
    assert.equal(appearances[0].payload.presentationId, 'leaderboard-3');
    restarted.stop();
  });

  it('after a restart in a non-ambient mode nothing is scheduled', () => {
    const { db, eventId, scheduler } = fixture();
    updateBroadcastState(db, eventId, { mode: 'mvp' });
    scheduler.start();
    assert.equal(scheduler.getStatus().intervalTimerArmed, false);
    tick(INTERVAL * 2);
    assert.equal(scheduler.getPresentation(), null);
    scheduler.stop();
  });
});

describe('display state recovery', () => {
  it('a client that connects mid-presentation receives it in the state snapshot', () => {
    const { db, scheduler } = fixture();
    scheduler.start();
    tick(INTERVAL);
    tick(5000); // 10 seconds still to go

    const snapshot = buildState(db, { mediaDirectory: os.tmpdir(), getPresentation: scheduler.getPresentation, getScheduleStatus: scheduler.getStatus });
    const presentation = snapshot.broadcast.presentation;
    assert.equal(snapshot.broadcast.mode, 'ambient');
    assert.equal(presentation.type, 'scheduled_leaderboard');
    assert.equal(presentation.page, 1);
    assert.equal(presentation.totalPages, 2);
    assert.equal(presentation.standings.length, 9);
    assert.equal(Date.parse(presentation.endsAt) - Date.parse(snapshot.generatedAt), DURATION - 5000);

    tick(DURATION - 5000);
    const after = buildState(db, { mediaDirectory: os.tmpdir(), getPresentation: scheduler.getPresentation, getScheduleStatus: scheduler.getStatus });
    assert.equal(after.broadcast.presentation, null);
    assert.ok(after.broadcast.schedule.nextRunAt);
    assert.equal(after.broadcast.schedule.leaderboardIntervalMs, INTERVAL);
    scheduler.stop();
  });

  it('the snapshot works without a scheduler (presentation is null)', () => {
    const { db } = fixture();
    const snapshot = buildState(db, { mediaDirectory: os.tmpdir() });
    assert.equal(snapshot.broadcast.presentation, null);
    assert.equal(snapshot.broadcast.mode, 'ambient');
  });
});

describe('scheduled leaderboard settings', () => {
  it('rejects invalid values', () => {
    const { db, eventId } = createTestTournament({ teamCount: 2 });
    const bad = [
      { leaderboardIntervalMs: 1000 },
      { leaderboardIntervalMs: 'soon' },
      { leaderboardDisplayDurationMs: 500 },
      { leaderboardDisplayDurationMs: 300000 }, // not shorter than the interval
      { teamsPerPage: 0 },
      { teamsPerPage: 51 },
      { enabled: 'yes' },
    ];
    for (const changes of bad) {
      assert.throws(() => changeSchedule(db, eventId, changes), (error) => error instanceof AppError && error.status === 400, JSON.stringify(changes));
    }
    assert.equal(getTournamentConfig(db, eventId).scheduledLeaderboard.leaderboardIntervalMs, 300000);
  });

  it('a configuration saved before this feature gets the defaults', () => {
    const { db, eventId } = createTestTournament({ teamCount: 2 });
    const saved = JSON.parse(db.prepare('SELECT config_json FROM event_config').get().config_json);
    delete saved.scheduledLeaderboard;
    db.prepare('UPDATE event_config SET config_json = ?').run(JSON.stringify(saved));
    assert.deepEqual(getTournamentConfig(db, eventId).scheduledLeaderboard, { enabled: true, leaderboardIntervalMs: 300000, leaderboardDisplayDurationMs: 15000, teamsPerPage: 9 });
    assert.doesNotThrow(() => validateTournamentConfig(saved)); // old backups carry such a config
  });
});
