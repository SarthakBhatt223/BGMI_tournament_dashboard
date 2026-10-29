import { useEffect, useState } from 'react';
import { api } from '../services/api.js';
import { BROADCAST_MODE_LABELS } from '../utils/formatters.js';

const MODES = ['ambient', 'standings', 'mvp'];

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

  return (
    <div className="panel-stack">
      <section className="panel">
        <h2>Public display mode</h2>
        <div className="button-group">
          {MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              className={broadcast.mode === mode ? 'button-active' : 'button-secondary'}
              disabled={busy}
              aria-pressed={broadcast.mode === mode}
              onClick={() => run(() => api.updateBroadcast({ mode }))}
            >
              {mode === 'standings' ? 'Leaderboard' : BROADCAST_MODE_LABELS[mode]}
            </button>
          ))}
        </div>

        <h3>Leaderboard layout</h3>
        <div className="button-group">
          {[
            ['full', 'Full (all teams)'],
            ['scrolling', `Scrolling (${state.config.display.scrollPageSize} at a time)`],
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

        <form
          className="form-row"
          onSubmit={(event) => {
            event.preventDefault();
            run(() => api.updateBroadcast({ scrollIntervalSeconds: Number(intervalInput) }));
          }}
        >
          <label>
            Scroll interval (seconds, 3-120)
            <input type="number" min="3" max="120" value={intervalInput} onChange={(event) => setIntervalInput(event.target.value)} />
          </label>
          <button type="submit" disabled={busy}>
            Apply interval
          </button>
        </form>

        <form
          className="form-row"
          onSubmit={(event) => {
            event.preventDefault();
            run(() => api.updateBroadcast({ headlineText: headlineInput, subtitleText: subtitleInput }));
          }}
        >
          <label>
            Display headline (blank = event name)
            <input value={headlineInput} maxLength={120} onChange={(event) => setHeadlineInput(event.target.value)} />
          </label>
          <label>
            Display subtitle
            <input value={subtitleInput} maxLength={120} onChange={(event) => setSubtitleInput(event.target.value)} />
          </label>
          <button type="submit" disabled={busy}>
            Apply text
          </button>
        </form>
      </section>

      <section className="panel">
        <h2>MVP (chosen by the organizer)</h2>
        <p className="muted">The MVP is never picked automatically. The finish ranking below is only a supporting statistic.</p>
        <div className="form-row">
          <label>
            MVP player
            <select
              value={broadcast.mvpPlayerId ?? ''}
              disabled={busy}
              onChange={(event) => run(() => api.selectMvp(event.target.value === '' ? null : Number(event.target.value)))}
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
      </section>
    </div>
  );
}
