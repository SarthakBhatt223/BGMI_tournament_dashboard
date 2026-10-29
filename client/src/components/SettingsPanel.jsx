import { useState } from 'react';
import { api } from '../services/api.js';

export default function SettingsPanel({ state, run, busy }) {
  const [eventName, setEventName] = useState(state.event.name);
  const [clubName, setClubName] = useState(state.event.clubName);
  const [configText, setConfigText] = useState(JSON.stringify(state.config, null, 2));
  const [configParseError, setConfigParseError] = useState('');

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
      <section className="panel">
        <h2>Event</h2>
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
      </section>

      <section className="panel">
        <h2>Scoring and display configuration</h2>
        <p className="muted">
          The placement-point table and tie-breakers are placeholders until the organizer confirms the official rules. Matches that are
          already finalized keep their frozen scores; reopen and finalize a match to re-score it with new rules.
        </p>
        <form onSubmit={saveConfig} className="stacked-form">
          <textarea className="config-editor" value={configText} onChange={(event) => setConfigText(event.target.value)} rows={26} spellCheck={false} />
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
      </section>
    </div>
  );
}
