import { useState } from 'react';
import { api } from '../services/api.js';
import { formatClockTime } from '../utils/formatters.js';
import Panel from './Panel.jsx';

function downloadJson(fileName, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export default function BackupPanel({ run, busy }) {
  const [message, setMessage] = useState('');
  const [auditEntries, setAuditEntries] = useState([]);

  async function exportBackup() {
    setMessage('');
    const outcome = await run(() => api.exportBackup());
    if (outcome.ok) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      downloadJson(`bgmi-backup-${stamp}.json`, outcome.result);
      setMessage('Backup downloaded. Keep it somewhere outside this computer too.');
    }
  }

  async function importBackup(file) {
    setMessage('');
    let backup;
    try {
      backup = JSON.parse(await file.text());
    } catch {
      setMessage('That file is not valid JSON. Nothing was changed.');
      return;
    }
    const confirmed = window.confirm(
      'Restoring REPLACES all current teams, players, matches and scores with the contents of this file.\n\nContinue?',
    );
    if (!confirmed) return;
    const outcome = await run(() => api.importBackup(backup));
    if (outcome.ok) setMessage('Backup restored.');
  }

  async function loadAuditLog() {
    const outcome = await run(() => api.getAuditLog(50));
    if (outcome.ok) setAuditEntries(outcome.result.entries);
  }

  return (
    <div className="panel-stack">
      <Panel title="Backup and restore">
        <div className="form-row">
          <button type="button" className="export-button" disabled={busy} onClick={exportBackup}>
            Export backup (JSON)
          </button>
          <label className="danger-zone">
            Restore from backup file (replaces all current data)
            <input
              type="file"
              accept="application/json,.json"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files[0];
                if (file) importBackup(file);
                event.target.value = '';
              }}
            />
          </label>
        </div>
        <p className="muted">The file is validated by the server first. If it is invalid, nothing is changed.</p>
        {message && <p className="form-message-info">{message}</p>}
      </Panel>

      <Panel title="Recent activity">
        <button type="button" className="button-secondary" disabled={busy} onClick={loadAuditLog}>
          Load latest 50 actions
        </button>
        {auditEntries.length > 0 && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {auditEntries.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatClockTime(entry.createdAt)}</td>
                  <td>{entry.action}</td>
                  <td className="muted">{JSON.stringify(entry.details)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
