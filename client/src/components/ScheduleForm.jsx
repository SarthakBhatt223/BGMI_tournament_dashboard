import { useEffect, useState } from 'react';
import { api } from '../services/api.js';

// Scheduled leaderboard: saved through the same validated config endpoint as the JSON editor,
// changing only the scheduledLeaderboard block.
export default function ScheduleForm({ state, run, busy }) {
  const saved = state.config.scheduledLeaderboard;
  const [enabled, setEnabled] = useState(saved.enabled);
  const [intervalMinutes, setIntervalMinutes] = useState(String(saved.leaderboardIntervalMs / 60000));
  const [durationSeconds, setDurationSeconds] = useState(String(saved.leaderboardDisplayDurationMs / 1000));
  const [teamsPerPage, setTeamsPerPage] = useState(String(saved.teamsPerPage));

  useEffect(() => {
    setEnabled(saved.enabled);
    setIntervalMinutes(String(saved.leaderboardIntervalMs / 60000));
    setDurationSeconds(String(saved.leaderboardDisplayDurationMs / 1000));
    setTeamsPerPage(String(saved.teamsPerPage));
  }, [saved.enabled, saved.leaderboardIntervalMs, saved.leaderboardDisplayDurationMs, saved.teamsPerPage]);

  function save(event) {
    event.preventDefault();
    run(() =>
      api.updateConfig({
        ...state.config,
        scheduledLeaderboard: {
          enabled,
          leaderboardIntervalMs: Math.round(Number(intervalMinutes) * 60000),
          leaderboardDisplayDurationMs: Math.round(Number(durationSeconds) * 1000),
          teamsPerPage: Number(teamsPerPage),
        },
      }),
    );
  }

  return (
    <form className="form-row" onSubmit={save}>
      <label className="check-field">
        <span>Scheduled leaderboard</span>
        <select value={enabled ? 'on' : 'off'} onChange={(event) => setEnabled(event.target.value === 'on')}>
          <option value="on">Enabled</option>
          <option value="off">Disabled</option>
        </select>
      </label>
      <label>
        Every (minutes)
        <input type="number" min="0.1" step="any" value={intervalMinutes} onChange={(event) => setIntervalMinutes(event.target.value)} />
      </label>
      <label>
        Visible for (seconds)
        <input type="number" min="1" step="1" value={durationSeconds} onChange={(event) => setDurationSeconds(event.target.value)} />
      </label>
      <label>
        Teams per page
        <input type="number" min="1" max="50" step="1" value={teamsPerPage} onChange={(event) => setTeamsPerPage(event.target.value)} />
      </label>
      <button type="submit" disabled={busy}>Save schedule</button>
    </form>
  );
}
