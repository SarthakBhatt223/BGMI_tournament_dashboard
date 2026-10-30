// Server-controlled automatic leaderboard.
//
// While the display is in AMBIENT mode, the leaderboard appears for a short time every
// `leaderboardIntervalMs` and then the display goes back to ambient, alternating between the
// pages of standings (page 1, page 2, ... wrapping around).
//
// How it works
//  * A scheduled appearance is a temporary OVERLAY ("presentation"). The persisted broadcast mode
//    stays 'ambient' the whole time; the presentation lives in memory and is part of the state
//    snapshot (`broadcast.presentation`). So a crash, a restart or a manual change can never leave
//    the display stuck on the leaderboard, and a display that reconnects gets it from the snapshot.
//  * One scheduler exists per server process. Socket connections never touch it, so clients
//    reconnecting cannot create more timers. `start()` is idempotent.
//  * At most two timers exist: the interval timer and the presentation-end timer.
//  * The operator always wins. Any manual mode selection cancels a running presentation, and
//    while the mode is not ambient (full leaderboard, MVP) nothing is scheduled. Returning to
//    ambient starts a fresh countdown; nothing is fired "to catch up" after a pause or a restart.
//  * Standings are read from computeStandings at the moment of each appearance (the existing
//    official scoring and tie-break rules); no scoring is duplicated here.
import { runInTransaction } from '../db/database.js';
import { getBroadcastState } from './broadcastService.js';
import { getActiveEvent, getTournamentConfig } from './eventService.js';
import { computeStandings, pageIndexForAppearance, splitIntoPages } from './standingsService.js';
import { SOCKET_EVENTS } from '../socketEvents.js';

export const PRESENTATION_TYPE = 'scheduled_leaderboard';

function toLeaderboardEntry(row) {
  return {
    rank: row.rank,
    teamId: row.teamId,
    name: row.name,
    shortName: row.shortName,
    logoPath: row.logoPath,
    wwcd: row.wwcd,
    finishCount: row.finishCount,
    finishPoints: row.finishPoints,
    placementPoints: row.placementPoints,
    totalPoints: row.totalPoints,
  };
}

export function createLeaderboardScheduler({
  db,
  publish, // () => void  pushes the state snapshot to every client
  emit, // (eventName, payload) => void  Socket.IO broadcast
  logError = console.error,
  now = () => Date.now(),
  setTimer = (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimer = (timer) => globalThis.clearTimeout(timer),
}) {
  let started = false;
  let intervalTimer = null;
  let armedIntervalMs = null;
  let nextRunAt = null;
  let endTimer = null;
  let presentation = null;

  function safeEmit(eventName, payload) {
    try {
      emit(eventName, payload);
    } catch (error) {
      logError(`Failed to emit ${eventName}:`, error);
    }
  }

  function safePublish() {
    try {
      publish();
    } catch (error) {
      logError('Failed to publish state:', error);
    }
  }

  function startTimer(callback, ms) {
    const timer = setTimer(callback, ms);
    if (timer && typeof timer.unref === 'function') timer.unref(); // never keep the process alive
    return timer;
  }

  function readSettings() {
    const event = getActiveEvent(db);
    const schedule = getTournamentConfig(db, event.id).scheduledLeaderboard;
    return { eventId: event.id, eventStatus: event.status, mode: getBroadcastState(db).mode, ...schedule };
  }

  // The leaderboard may only appear while it is enabled, the display is in ambient mode and the
  // tournament is not over.
  const mayRun = (settings) => settings.enabled && settings.mode === 'ambient' && settings.eventStatus !== 'completed';

  function clearIntervalTimer() {
    if (intervalTimer !== null) clearTimer(intervalTimer);
    intervalTimer = null;
    armedIntervalMs = null;
    nextRunAt = null;
  }

  function armInterval(ms) {
    clearIntervalTimer();
    armedIntervalMs = ms;
    nextRunAt = now() + ms;
    intervalTimer = startTimer(onIntervalElapsed, ms);
  }

  function cancelPresentation(reason) {
    if (endTimer !== null) clearTimer(endTimer);
    endTimer = null;
    if (presentation === null) return false;
    const cancelled = presentation;
    presentation = null;
    // The caller publishes the snapshot (it is part of the same commit / request).
    safeEmit(SOCKET_EVENTS.broadcastState, {
      phase: 'cancelled',
      reason,
      presentationId: cancelled.presentationId,
      mode: 'ambient',
      presentation: null,
      timestamp: new Date(now()).toISOString(),
    });
    return true;
  }

  function endPresentation() {
    endTimer = null;
    if (presentation === null) return;
    const finished = presentation;
    presentation = null;
    safePublish();
    safeEmit(SOCKET_EVENTS.broadcastState, {
      phase: 'returned_to_ambient',
      reason: 'duration_elapsed',
      presentationId: finished.presentationId,
      mode: 'ambient',
      presentation: null,
      timestamp: new Date(now()).toISOString(),
    });
  }

  // Builds and starts one presentation. Returns it, or null when nothing was shown.
  function fire(settings, reason) {
    if (presentation !== null) return null; // never two presentations at once
    const standings = computeStandings(db, settings.eventId);
    const pages = splitIntoPages(standings, settings.teamsPerPage);
    if (pages.length === 0) return null; // no teams: nothing to show

    // Persist the appearance counter first (a real transaction), then announce.
    const appearance = runInTransaction(db, () => {
      const { scheduled_leaderboard_count: count } = db.prepare('SELECT scheduled_leaderboard_count FROM broadcast_state WHERE id = 1').get();
      db.prepare('UPDATE broadcast_state SET scheduled_leaderboard_count = ? WHERE id = 1').run(count + 1);
      return count + 1;
    });
    const pageIndex = pageIndexForAppearance(appearance, pages.length);
    const startedAtMs = now();
    presentation = {
      type: PRESENTATION_TYPE,
      reason,
      presentationId: `leaderboard-${appearance}`,
      page: pageIndex + 1,
      totalPages: pages.length,
      teamsPerPage: settings.teamsPerPage,
      displayDurationMs: settings.leaderboardDisplayDurationMs,
      returnToMode: 'ambient',
      standings: pages[pageIndex].map(toLeaderboardEntry),
      startedAt: new Date(startedAtMs).toISOString(),
      endsAt: new Date(startedAtMs + settings.leaderboardDisplayDurationMs).toISOString(),
      timestamp: new Date(startedAtMs).toISOString(),
    };
    endTimer = startTimer(endPresentation, settings.leaderboardDisplayDurationMs);

    safePublish();
    safeEmit(SOCKET_EVENTS.broadcastLeaderboard, presentation);
    safeEmit(SOCKET_EVENTS.broadcastState, {
      phase: 'leaderboard_started',
      reason,
      presentationId: presentation.presentationId,
      mode: 'ambient',
      presentation,
      timestamp: presentation.timestamp,
    });
    return presentation;
  }

  function onIntervalElapsed() {
    intervalTimer = null;
    nextRunAt = null;
    let settings;
    try {
      settings = readSettings();
    } catch (error) {
      logError('Leaderboard scheduler could not read its settings:', error);
      return;
    }
    if (!mayRun(settings)) return; // paused; evaluate() re-arms it when the display returns to ambient
    try {
      fire(settings, 'scheduled_interval');
    } catch (error) {
      logError('Scheduled leaderboard failed:', error);
    }
    armInterval(settings.leaderboardIntervalMs); // fixed cadence, start to start
  }

  // Brings the timers in line with the current persisted state. Safe to call at any time and as
  // often as needed: it arms the interval timer only when none is armed (or the interval
  // changed), and never creates a second one.
  function evaluate() {
    if (!started) return;
    let settings;
    try {
      settings = readSettings();
    } catch (error) {
      logError('Leaderboard scheduler could not read its settings:', error);
      return;
    }
    if (presentation !== null && !mayRun(settings)) {
      cancelPresentation(settings.mode !== 'ambient' ? 'mode_changed' : 'disabled');
    }
    if (!mayRun(settings)) {
      clearIntervalTimer();
      return;
    }
    if (intervalTimer === null || armedIntervalMs !== settings.leaderboardIntervalMs) {
      armInterval(settings.leaderboardIntervalMs);
    }
  }

  return {
    // Idempotent: calling it again (for example from a reconnect handler) does nothing.
    start() {
      if (started) return;
      started = true;
      evaluate(); // fresh countdown; missed appearances are never replayed
    },
    stop() {
      started = false;
      clearIntervalTimer();
      if (endTimer !== null) clearTimer(endTimer);
      endTimer = null;
      presentation = null;
    },
    evaluate,
    // Called inside the broadcast-update transaction/request, before the snapshot is published.
    handleManualBroadcastChange(body) {
      if (body && body.mode !== undefined) cancelPresentation('manual_mode_change');
      evaluate();
    },
    cancelPresentation,
    // Shows the leaderboard now (tests and future admin "preview"). Only while it is allowed to run.
    triggerNow(reason = 'manual_trigger') {
      if (!started) return null;
      const settings = readSettings();
      return mayRun(settings) ? fire(settings, reason) : null;
    },
    getPresentation: () => presentation,
    getStatus: () => ({
      started,
      intervalTimerArmed: intervalTimer !== null,
      presentationTimerArmed: endTimer !== null,
      presentationActive: presentation !== null,
      nextRunAt: nextRunAt === null ? null : new Date(nextRunAt).toISOString(),
    }),
  };
}
