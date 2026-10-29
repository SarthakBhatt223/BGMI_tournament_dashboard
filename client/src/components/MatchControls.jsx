import { useState } from 'react';
import { api } from '../services/api.js';
import { statusText } from '../hooks/useKeyedActions.js';
import { describeMatch, makeRequestId, MATCH_STATUS_LABELS } from '../utils/formatters.js';

function MatchPicker({ state, run, busy }) {
  const currentMatch = state.currentMatch?.match ?? null;
  const [newMatchLabel, setNewMatchLabel] = useState('');

  function createMatch(event) {
    event.preventDefault();
    run(async () => {
      await api.createMatch({ label: newMatchLabel });
      setNewMatchLabel('');
    });
  }

  return (
    <section className="panel">
      <h2>Match</h2>
      <div className="form-row">
        <label>
          Current match
          <select
            value={currentMatch?.id ?? ''}
            disabled={busy}
            onChange={(event) => run(() => api.updateBroadcast({ currentMatchId: event.target.value === '' ? null : Number(event.target.value) }))}
          >
            <option value="">None selected</option>
            {state.matches.map((match) => (
              <option key={match.id} value={match.id}>
                {describeMatch(match)} ({MATCH_STATUS_LABELS[match.status]})
              </option>
            ))}
          </select>
        </label>
        {currentMatch?.status === 'planned' && (
          <button type="button" disabled={busy} onClick={() => run(() => api.startMatch(currentMatch.id))}>
            Start match
          </button>
        )}
        {currentMatch?.status === 'in_progress' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Finalize ${describeMatch(currentMatch)}? Its scores are frozen until it is reopened.`)) {
                run(() => api.finalizeMatch(currentMatch.id));
              }
            }}
          >
            Finalize match
          </button>
        )}
        {currentMatch?.status === 'finalized' && (
          <button
            type="button"
            className="button-secondary"
            disabled={busy}
            onClick={() => {
              const reason = window.prompt('Why is this match being reopened? (recorded in the audit log)');
              if (reason && reason.trim()) run(() => api.reopenMatch(currentMatch.id, reason.trim()));
            }}
          >
            Reopen for correction
          </button>
        )}
      </div>
      <form className="form-row" onSubmit={createMatch}>
        <label>
          New match label (optional)
          <input value={newMatchLabel} onChange={(event) => setNewMatchLabel(event.target.value)} maxLength={60} placeholder="e.g. Erangel" />
        </label>
        <button type="submit" disabled={busy}>
          Create match
        </button>
      </form>
      {currentMatch && <p className="muted">Status: {MATCH_STATUS_LABELS[currentMatch.status]}</p>}
    </section>
  );
}

// Per-row feedback. "Saved" appears only after the server confirmed the change.
function RowStatus({ status }) {
  const text = statusText(status);
  return (
    <span className={`row-status row-status-${status?.state ?? 'idle'}`} role="status" aria-live="polite">
      {text}
    </span>
  );
}

function FinishStepper({ team, canScore, runFor, matchId, status }) {
  const label = team.name;
  // Each click gets its own request id: the server ignores a repeat of the same id (a retried
  // request) but counts every deliberate click.
  const step = (delta) => runFor(`team:${team.teamId}`, () => api.adjustTeamFinish(matchId, team.teamId, delta, makeRequestId()));
  return (
    <div className="stepper">
      <button type="button" className="stepper-button" aria-label={`Remove one finish from ${label}`} disabled={!canScore || team.finishCount <= 0} onClick={() => step(-1)}>
        &minus;
      </button>
      <output className="stepper-value" aria-label={`Finishes for ${label}`}>{team.finishCount}</output>
      <button type="button" className="stepper-button" aria-label={`Add one finish to ${label}`} disabled={!canScore} onClick={() => step(1)}>
        +
      </button>
      <RowStatus status={status} />
    </div>
  );
}

function ScoringHeader({ detail, state }) {
  const { match, summary } = detail;
  const finalized = match.status === 'finalized';
  const teamsWithTotals = detail.teams.filter((team) => team.finishEntered).length;
  const warnings = [];
  if (summary.duplicatePlacements.length > 0) {
    warnings.push(...summary.duplicatePlacements.map((entry) => `Placement ${entry.placement} is assigned to more than one team: ${entry.teams.join(', ')}.`));
  }
  const missing = summary.teamCount - summary.placementsEntered;
  if (missing > 0 && match.status !== 'planned') warnings.push(`${missing} team(s) have no placement yet.`);

  return (
    <>
      <div className="scoring-header">
        <div>
          <h2>{describeMatch(match)}</h2>
          <p className="muted">
            Status: {MATCH_STATUS_LABELS[match.status]}
            {state.config.scoring.requirePlayerReconciliationToFinalize && ' - finalizing requires matching player finishes (Player Finish Audit tab)'}
          </p>
        </div>
        <dl className="scoring-facts">
          <div><dt>Placements entered</dt><dd>{summary.placementsEntered}/{summary.teamCount}</dd></div>
          <div><dt>Finish totals entered</dt><dd>{teamsWithTotals}/{summary.teamCount}</dd></div>
          <div>
            <dt>Results</dt>
            <dd><span className={finalized ? 'badge badge-final' : 'badge badge-provisional'}>{finalized ? 'Finalized' : 'Provisional'}</span></dd>
          </div>
        </dl>
      </div>
      {warnings.length > 0 && (
        <ul className="form-message-warning scoring-warnings" aria-label="Placement warnings">
          {warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}
    </>
  );
}

function TeamScoring({ state, run, busy, runFor, statuses }) {
  const detail = state.currentMatch;
  if (!detail) {
    return (
      <section className="panel">
        <h2>Match scoring</h2>
        <p className="muted">Select or create a match above.</p>
      </section>
    );
  }
  const matchId = detail.match.id;
  const canScore = detail.match.status === 'in_progress';
  const allowDuplicates = state.config.scoring.allowDuplicatePlacements;
  const placementOptions = Array.from({ length: detail.teams.filter((team) => team.active).length }, (_, index) => index + 1);
  const holderByPlacement = new Map(detail.teams.filter((team) => team.placement !== null).map((team) => [team.placement, team]));

  function changePlacement(team, value) {
    if (value === '') run(() => api.clearPlacement(matchId, team.teamId));
    else run(() => api.setPlacement(matchId, team.teamId, Number(value)));
  }

  const finishTotal = detail.teams.reduce((sum, team) => sum + team.finishCount, 0);

  return (
    <section className="panel">
      <ScoringHeader detail={detail} state={state} />
      {!canScore && (
        <p className="form-message-info">
          {detail.match.status === 'planned' ? 'Start the match to enter finishes and placements.' : 'This match is finalized. Reopen it with a reason to correct scores.'}
        </p>
      )}
      <div className="table-scroll">
        <table className="data-table scoring-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Team</th>
              <th>Finishes</th>
              <th>Finish points</th>
              <th>Placement</th>
              <th>Placement points</th>
              <th>Total points</th>
            </tr>
          </thead>
          <tbody>
            {detail.teams.map((team) => {
              const problem = team.placementDuplicate ? 'duplicate' : team.placement === null && detail.match.status !== 'planned' ? 'missing' : '';
              return (
                <tr key={team.teamId} className={problem ? `row-${problem}` : ''}>
                  <td>{team.matchRank}</td>
                  <td>
                    {team.name}
                    {team.isWwcd && <span className="badge badge-final wwcd-badge">WWCD</span>}
                  </td>
                  <td>
                    <FinishStepper team={team} canScore={canScore} runFor={runFor} matchId={matchId} status={statuses[`team:${team.teamId}`]} />
                  </td>
                  <td>{team.finishPoints}</td>
                  <td>
                    <select
                      aria-label={`Placement for ${team.name}`}
                      value={team.placement ?? ''}
                      disabled={busy || !canScore}
                      onChange={(event) => changePlacement(team, event.target.value)}
                    >
                      <option value="">Not set</option>
                      {placementOptions.map((placement) => {
                        const holder = holderByPlacement.get(placement);
                        const takenByOther = holder && holder.teamId !== team.teamId;
                        return (
                          <option key={placement} value={placement} disabled={takenByOther && !allowDuplicates}>
                            {placement}{takenByOther ? ` (${holder.name})` : ''}
                          </option>
                        );
                      })}
                    </select>
                    {problem === 'duplicate' && <span className="flag flag-error">Duplicate</span>}
                    {problem === 'missing' && <span className="flag flag-warning">Missing</span>}
                  </td>
                  <td>{team.placementPoints}</td>
                  <td><strong>{team.totalPoints}</strong></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>All teams</td>
              <td>{finishTotal}</td>
              <td>{detail.teams.reduce((sum, team) => sum + team.finishPoints, 0)}</td>
              <td />
              <td>{detail.teams.reduce((sum, team) => sum + team.placementPoints, 0)}</td>
              <td>{detail.teams.reduce((sum, team) => sum + team.totalPoints, 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

export default function MatchControls({ state, run, busy, runFor, statuses }) {
  return (
    <div className="panel-stack">
      <MatchPicker state={state} run={run} busy={busy} />
      <TeamScoring state={state} run={run} busy={busy} runFor={runFor} statuses={statuses} />
    </div>
  );
}
