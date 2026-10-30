import { useState } from 'react';
import { api } from '../services/api.js';
import Panel from './Panel.jsx';

const CONFIRM_WORD = 'RESET';

// Clears everything recorded during matches (for testing) and keeps the roster and settings.
// The server saves a full backup file first, so a mistaken reset can be undone in Backup.
export default function ResetScoresPanel({ state, run, busy }) {
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState(null);
  const matchCount = state.matches.length;

  async function reset() {
    if (typed !== CONFIRM_WORD) return;
    if (!window.confirm(`Delete ${matchCount} match(es) with all scores, finishes and eliminations? Teams and players are kept.`)) return;
    const outcome = await run(() => api.resetScores());
    if (outcome.ok) {
      setResult(outcome.result);
      setTyped('');
    }
  }

  return (
    <Panel title="Reset test data" className="danger-panel">
      <p>
        Removes <strong>all matches, placements, finish totals, player finishes and eliminations</strong>, clears the selected match and
        MVP, and restarts match numbering at 1. Use it after testing.
      </p>
      <p className="muted">
        Kept: teams, players, logos, event name, scoring rules and display settings. Right now there {matchCount === 1 ? 'is' : 'are'}{' '}
        {matchCount} match{matchCount === 1 ? '' : 'es'} to remove. A backup file of everything is saved on the server computer first (in
        the data/backups folder); restore it from the Backup tab to undo.
      </p>
      <div className="form-row">
        <label>
          Type {CONFIRM_WORD} to enable the button
          <input value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" spellCheck={false} />
        </label>
        <button type="button" className="button-danger" disabled={busy || typed !== CONFIRM_WORD} onClick={reset}>
          Reset all scores
        </button>
      </div>
      {result && (
        <p className="form-message-info">
          Reset done: removed {result.removed.matches} match(es), {result.removed.finishEvents} finish record(s) and{' '}
          {result.removed.eliminations} elimination(s).
          {result.backupFile && ` Backup saved as ${result.backupFile}.`}
        </p>
      )}
    </Panel>
  );
}
