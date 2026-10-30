import { useEffect, useState } from 'react';
import { formatCountdown, useServerCountdown } from '../hooks/useServerCountdown.js';
import { api } from '../services/api.js';
import { BROADCAST_MODE_LABELS } from '../utils/formatters.js';
import EliminationPanel from './EliminationPanel.jsx';
import Panel from './Panel.jsx';
import ScheduleForm from './ScheduleForm.jsx';

const MODES = ['ambient', 'standings', 'mvp'];

// What the audience sees right now, in one glance.
function LiveDisplayState({ state }) {
  const { broadcast, leaderboard } = state;
  const schedule = broadcast.schedule;
  const nextIn = useServerCountdown(schedule?.enabled ? schedule.nextRunAt : null, state.generatedAt);
  const overlay = broadcast.presentation;

  let showing = BROADCAST_MODE_LABELS[broadcast.mode];
  if (broadcast.mode === 'standings') {
    showing += broadcast.leaderboardLayout === 'scrolling'
      ? ` - Compact, page ${leaderboard.currentPageIndex + 1} of ${leaderboard.pageCount}`
      : ' - Full';
  }
  if (overlay) showing = `Ambient + scheduled leaderboard (page ${overlay.page} of ${overlay.totalPages})`;

  return (
    <div className="live-state">
      <span className="badge badge-live"><span className="status-dot" aria-hidden="true" /> On air</span>
      <div className="live-state-main">
        <span className="stat-label">Display is showing</span>
        <strong className="live-state-value">{showing}</strong>
      </div>
      <div className="live-state-side">
        <span className="stat-label">Next scheduled leaderboard</span>
        <strong className="live-state-value">
          {!schedule?.enabled ? 'Off' : overlay ? 'On screen' : formatCountdown(nextIn)}
        </strong>
        {broadcast.mode !== 'ambient' && schedule?.enabled && <span className="stat-detail">Only runs in ambient mode</span>}
      </div>
    </div>
  );
}

export default function BroadcastControls({ state, run, busy }) {
  const { broadcast } = state;
  const [intervalInput, setIntervalInput] = useState(String(broadcast.scrollIntervalSeconds));
  const [headlineInput, setHeadlineInput] = useState(broadcast.headlineText ?? '');
  const [subtitleInput, setSubtitleInput] = useState(broadcast.subtitleText ?? '');

  // Follow changes made from another admin window, without overwriting while typing.
  useEffect(() => setIntervalInput(String(broadcast.scrollIntervalSeconds)), [broadcast.scrollIntervalSeconds]);
  useEffect(() => setHeadlineInput(broadcast.headlineText ?? ''), [broadcast.headlineText]);
  useEffect(() => setSubtitleInput(broadcast.subtitleText ?? ''), [broadcast.subtitleText]);

  const mvpOptions = state.players.filter((player) => player.active);
  const { leaderboard } = state;
  const compactLabel = `Compact (${leaderboard.teamsPerPage} per page)`;
  const mvpIsLive = broadcast.mode === 'mvp';

  return (
    <div className="panel-stack">
      <Panel title="Live display">
        <LiveDisplayState state={state} />
        <h3>Mode</h3>
        <div className="mode-buttons">
          {MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              className={`button-large ${broadcast.mode === mode ? 'button-active' : 'button-secondary'}`}
              disabled={busy}
              aria-pressed={broadcast.mode === mode}
              onClick={() => run(() => api.updateBroadcast({ mode }))}
            >
              {mode === 'standings' ? 'Leaderboard' : BROADCAST_MODE_LABELS[mode]}
            </button>
          ))}
        </div>
      </Panel>

      <div className="broadcast-grid">
        <Panel title="Leaderboard">
          <h3 className="first-heading">Layout</h3>
          <div className="button-group">
            {[
              ['full', `Full (all ${leaderboard.teamCount} teams)`],
              ['scrolling', compactLabel],
            ].map(([layout, label]) => (
              <button
                key={layout}
                type="button"
                className={broadcast.leaderboardLayout === layout ? 'button-active' : 'button-secondary'}
                disabled={busy}
                aria-pressed={broadcast.leaderboardLayout === layout}
                onClick={() => run(() => api.updateBroadcast({ leaderboardLayout: layout }))}
              >
                {label}
              </button>
            ))}
          </div>

          {leaderboard.pageCount > 0 && (
            <div className="compact-page-indicator">
              <span>
                Compact page <strong>{leaderboard.currentPageIndex + 1}</strong> of <strong>{leaderboard.pageCount}</strong>
              </span>
              <button
                type="button"
                className="button-secondary"
                disabled={busy || leaderboard.pageCount < 2}
                onClick={() => run(() => api.updateBroadcast({ advanceLeaderboardPage: true }))}
              >
                Next leaderboard page
              </button>
            </div>
          )}
          <p className="muted">Each time the leaderboard is put on the display it moves on to the next page.</p>

          <form
            className="form-row"
            onSubmit={(event) => {
              event.preventDefault();
              run(() => api.updateBroadcast({ scrollIntervalSeconds: Number(intervalInput) }));
            }}
          >
            <label>
              Page flip interval (seconds)
              <input type="number" min="3" max="120" value={intervalInput} onChange={(event) => setIntervalInput(event.target.value)} />
            </label>
            <button type="submit" disabled={busy}>
              Apply
            </button>
          </form>
          <p className="muted">Only used when rotatePagesWhileVisible is turned on in Settings.</p>
        </Panel>

        <Panel title="Scheduled leaderboard">
          <p className="muted">Appears over the ambient screen on a timer, then returns to ambient.</p>
          <ScheduleForm state={state} run={run} busy={busy} />
        </Panel>
      </div>

      <EliminationPanel state={state} run={run} busy={busy} />

      <div className="broadcast-grid">
        <Panel title="MVP (chosen by the organizer)">
          <p className="muted">The MVP is never picked automatically. The finish ranking below is only a supporting statistic.</p>
          <div className="form-row">
            <label>
              MVP player
              <select
                value={broadcast.mvpPlayerId ?? ''}
                disabled={busy}
                onChange={(event) => {
                  if (mvpIsLive && !window.confirm('The MVP showcase is on the live display. Change the MVP now?')) return;
                  run(() => api.selectMvp(event.target.value === '' ? null : Number(event.target.value)));
                }}
              >
                <option value="">Not selected</option>
                {mvpOptions.map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.name} ({player.teamName})
                  </option>
                ))}
              </select>
            </label>
          </div>
          <h3>Most finishes</h3>
          <ol className="plain-list">
            {state.topFraggers.map((player) => (
              <li key={player.playerId}>
                {player.name} ({player.teamName}) - {player.totalFinishes}
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title="Display text">
          <form
            className="stacked-form"
            onSubmit={(event) => {
              event.preventDefault();
              run(() => api.updateBroadcast({ headlineText: headlineInput, subtitleText: subtitleInput }));
            }}
          >
            <label>
              Headline (blank = event name)
              <input value={headlineInput} maxLength={120} onChange={(event) => setHeadlineInput(event.target.value)} />
            </label>
            <label>
              Subtitle
              <input value={subtitleInput} maxLength={120} onChange={(event) => setSubtitleInput(event.target.value)} />
            </label>
            <div className="button-group">
              <button type="submit" disabled={busy}>
                Apply text
              </button>
            </div>
          </form>
        </Panel>
      </div>
    </div>
  );
}
