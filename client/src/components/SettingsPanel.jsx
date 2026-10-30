import { useState } from 'react';
import { api } from '../services/api.js';
import Panel from './Panel.jsx';
import ResetScoresPanel from './ResetScoresPanel.jsx';
import ScheduleForm from './ScheduleForm.jsx';

const TIE_BREAKER_LABELS = {
  wwcd: 'WWCD count',
  placementPoints: 'Placement points',
  finishPoints: 'Finish points',
  bestPlacement: 'Best placement',
};

export default function SettingsPanel({ state, run, busy }) {
  const [eventName, setEventName] = useState(state.event.name);
  const [clubName, setClubName] = useState(state.event.clubName);
  const [configText, setConfigText] = useState(JSON.stringify(state.config, null, 2));
  const [configParseError, setConfigParseError] = useState('');
  const { scoring } = state.config;
  const placements = Object.entries(scoring.placementPoints).sort((a, b) => Number(a[0]) - Number(b[0]));

  function saveConfig(event) {
    event.preventDefault();
    let parsed;
    try {
      parsed = JSON.parse(configText);
    } catch (error) {
      setConfigParseError(`Not valid JSON: ${error.message}`);
      return;
    }
    setConfigParseError('');
    run(() => api.updateConfig(parsed));
  }

  return (
    <div className="panel-stack">
      <Panel title="Event">
        <form
          className="form-row"
          onSubmit={(event) => {
            event.preventDefault();
            run(() => api.updateEvent({ name: eventName, clubName }));
          }}
        >
          <label>
            Event name
            <input value={eventName} onChange={(event) => setEventName(event.target.value)} maxLength={100} required />
          </label>
          <label>
            Organizing club
            <input value={clubName} onChange={(event) => setClubName(event.target.value)} maxLength={100} required />
          </label>
          <button type="submit" disabled={busy}>
            Save event
          </button>
        </form>
      </Panel>

      <Panel title="Scheduled leaderboard">
        <p className="muted">
          While the display is in ambient mode, the leaderboard appears on its own at this interval and then returns to ambient. Successive
          appearances alternate between pages.
        </p>
        <ScheduleForm state={state} run={run} busy={busy} />
      </Panel>

      <Panel title="Scoring (current values)">
        <div className="settings-summary">
          <div>
            <h3>Placement points</h3>
            <table className="data-table compact-table">
              <thead>
                <tr><th>Placement</th><th className="col-number">Points</th></tr>
              </thead>
              <tbody>
                {placements.map(([placement, points]) => (
                  <tr key={placement}><td>{placement}</td><td className="col-number num">{points}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="info-strip">
            <div><dt>Points per finish</dt><dd>{scoring.finishPointsPerElimination}</dd></div>
            <div><dt>WWCD placement</dt><dd>{scoring.winnerPlacement}</dd></div>
            <div><dt>Duplicate placements</dt><dd>{scoring.allowDuplicatePlacements ? 'Allowed' : 'Not allowed'}</dd></div>
            <div><dt>Finalize needs finish audit</dt><dd>{scoring.requirePlayerReconciliationToFinalize ? 'Yes' : 'No'}</dd></div>
            <div>
              <dt>Tie-breakers</dt>
              <dd className="tie-list">{scoring.tieBreakers.map((key, index) => `${index + 1}. ${TIE_BREAKER_LABELS[key] ?? key}`).join('  ')}</dd>
            </div>
          </dl>
        </div>
      </Panel>

      <Panel title="Advanced configuration (JSON)">
        <p className="muted">
          Edits every setting above and more. The server validates the whole document and rejects it if anything is invalid. Matches that are
          already finalized keep their frozen scores; reopen and finalize a match to re-score it with new rules.
        </p>
        <form onSubmit={saveConfig} className="stacked-form">
          <textarea className="config-editor" value={configText} onChange={(event) => setConfigText(event.target.value)} rows={22} spellCheck={false} />
          {configParseError && <p className="form-message-error">{configParseError}</p>}
          <div className="button-group">
            <button type="submit" disabled={busy}>
              Save configuration
            </button>
            <button type="button" className="button-secondary" onClick={() => setConfigText(JSON.stringify(state.config, null, 2))}>
              Reset editor to saved
            </button>
          </div>
        </form>
      </Panel>

      <ResetScoresPanel state={state} run={run} busy={busy} />
    </div>
  );
}
