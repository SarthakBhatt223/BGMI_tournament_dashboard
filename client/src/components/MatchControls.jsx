import { useState } from 'react';
import { api } from '../services/api.js';
import { statusText } from '../hooks/useKeyedActions.js';
import { describeMatch, makeRequestId, MATCH_STATUS_LABELS } from '../utils/formatters.js';
import Panel from './Panel.jsx';
import TeamLogo from './TeamLogo.jsx';

const STATUS_PILL = {
  planned: 'Planned',
  in_progress: 'In progress - scoring live',
  finalized: 'Finalized - locked',
};

// The match bar stays at the top of the Scoring tab while the team table scrolls underneath it,
// so the match status and its primary action are always in view.
function MatchBar({ state, run, busy }) {
  const detail = state.currentMatch;
  const match = detail?.match ?? null;
  const [newMatchLabel, setNewMatchLabel] = useState('');

  function createMatch(event) {
    event.preventDefault();
    run(async () => {
      await api.createMatch({ label: newMatchLabel });
      setNewMatchLabel('');
    });
  }

  const summary = detail?.summary;
  const teamsWithTotals = detail ? detail.teams.filter((team) => team.finishEntered).length : 0;

  return (
    <section className="match-bar">
      <div className="match-bar-row">
        <label className="match-select">
          Match
          <select
            value={match?.id ?? ''}
            disabled={busy}
            onChange={(event) => run(() => api.updateBroadcast({ currentMatchId: event.target.value === '' ? null : Number(event.target.value) }))}
          >
            <option value="">None selected</option>
            {state.matches.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {describeMatch(entry)} ({MATCH_STATUS_LABELS[entry.status]})
              </option>
            ))}
          </select>
        </label>

        {match && <span className={`status-pill status-${match.status}`}><span className="status-dot" aria-hidden="true" />{STATUS_PILL[match.status]}</span>}

        {summary && (
          <dl className="match-facts">
            <div><dt>Placements</dt><dd>{summary.placementsEntered}/{summary.teamCount}</dd></div>
            <div><dt>Finish totals</dt><dd>{teamsWithTotals}/{summary.teamCount}</dd></div>
          </dl>
        )}

        <div className="match-actions">
          {match?.status === 'planned' && (
            <button type="button" className="button-large" disabled={busy} onClick={() => run(() => api.startMatch(match.id))}>
              Start match
            </button>
          )}
          {match?.status === 'in_progress' && (
            <button
              type="button"
              className="button-large"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Finalize ${describeMatch(match)}? Its scores are frozen until it is reopened.`)) {
                  run(() => api.finalizeMatch(match.id));
                }
              }}
            >
              Finalize match
            </button>
          )}
          {match?.status === 'finalized' && (
            <button
              type="button"
              className="button-danger button-large"
              disabled={busy}
              onClick={() => {
                const reason = window.prompt('Why is this match being reopened? (recorded in the audit log)');
                if (reason && reason.trim()) run(() => api.reopenMatch(match.id, reason.trim()));
              }}
            >
              Reopen for correction
            </button>
          )}
        </div>
      </div>

      {match && state.config.scoring.requirePlayerReconciliationToFinalize && match.status === 'in_progress' && (
        <p className="match-hint">Finalizing needs each team&apos;s player finishes to match its team total (Player Finish Audit tab).</p>
      )}

      <details className="new-match">
        <summary>New match</summary>
        <form className="form-row" onSubmit={createMatch}>
          <label>
            Label (optional)
            <input value={newMatchLabel} onChange={(event) => setNewMatchLabel(event.target.value)} maxLength={60} placeholder="e.g. Erangel" />
          </label>
          <button type="submit" disabled={busy}>
            Create match
          </button>
        </form>
      </details>
    </section>
  );
}

// Per-row feedback. "Saved" appears only after the server confirmed the change.
function RowStatus({ status }) {
  const text = statusText(status);
  const isError = status?.state === 'error';
  return (
    <span
      className={`row-status row-status-${status?.state ?? 'idle'}`}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
    >
      {isError ? `Not saved: ${text}` : text}
    </span>
  );
}

function FinishStepper({ team, canScore, runFor, matchId }) {
  const label = team.name;
  // Each click gets its own request id: the server ignores a repeat of the same id (a retried
  // request) but counts every deliberate click.
  const step = (delta) => runFor(`team:${team.teamId}`, () => api.adjustTeamFinish(matchId, team.teamId, delta, makeRequestId()));
  return (
    <div className="stepper">
      <button type="button" className="stepper-button stepper-minus" aria-label={`Remove one finish from ${label}`} disabled={!canScore || team.finishCount <= 0} onClick={() => step(-1)}>
        &minus;
      </button>
      <output className="stepper-value" aria-label={`Finishes for ${label}`}>{team.finishCount}</output>
      <button type="button" className="stepper-button stepper-plus" aria-label={`Add one finish to ${label}`} disabled={!canScore} onClick={() => step(1)}>
        +
      </button>
    </div>
  );
}

function PlacementSelect({ team, problem, canScore, busy, options, holderByPlacement, allowDuplicates, onChange }) {
  const state = problem === 'duplicate' ? 'duplicate' : team.placement === null ? 'unset' : 'set';
  return (
    <div className="placement-cell">
      <select
        className={`placement-select placement-${state}${problem === 'missing' ? ' placement-missing' : ''}`}
        aria-label={`Placement for ${team.name}`}
        value={team.placement ?? ''}
        disabled={busy || !canScore}
        onChange={(event) => onChange(team, event.target.value)}
      >
        <option value="">Not set</option>
        {options.map((placement) => {
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
    </div>
  );
}

function TeamScoring({ state, busy, runFor, statuses }) {
  const detail = state.currentMatch;
  if (!detail) {
    return (
      <Panel title="Match scoring">
        <p className="muted">Select or create a match above.</p>
      </Panel>
    );
  }
  const { match, summary } = detail;
  const matchId = match.id;
  const canScore = match.status === 'in_progress';
  const allowDuplicates = state.config.scoring.allowDuplicatePlacements;
  const placementOptions = Array.from({ length: detail.teams.filter((team) => team.active).length }, (_, index) => index + 1);
  const holderByPlacement = new Map(detail.teams.filter((team) => team.placement !== null).map((team) => [team.placement, team]));

  // Placement changes are saved per row too, so each row shows its own Saving / Saved / error.
  function changePlacement(team, value) {
    const key = `team:${team.teamId}`;
    if (value === '') runFor(key, () => api.clearPlacement(matchId, team.teamId));
    else runFor(key, () => api.setPlacement(matchId, team.teamId, Number(value)));
  }

  const warnings = [];
  for (const entry of summary.duplicatePlacements) {
    warnings.push(`Placement ${entry.placement} is assigned to more than one team: ${entry.teams.join(', ')}.`);
  }
  const missing = summary.teamCount - summary.placementsEntered;
  if (missing > 0 && match.status !== 'planned') warnings.push(`${missing} team(s) have no placement yet.`);

  const finishTotal = detail.teams.reduce((sum, team) => sum + team.finishCount, 0);

  return (
    <Panel className="scoring-panel">
      {!canScore && (
        <p className="form-message-info">
          {match.status === 'planned' ? 'Start the match to enter finishes and placements.' : 'This match is finalized. Reopen it with a reason to correct scores.'}
        </p>
      )}
      {warnings.length > 0 && (
        <ul className="form-message-warning scoring-warnings" aria-label="Placement warnings">
          {warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}
      <div className="table-scroll scoring-scroll">
        <table className="data-table scoring-table">
          <thead>
            <tr>
              <th className="col-rank">Rank</th>
              <th>Team</th>
              <th className="col-wwcd">WWCD</th>
              <th>Finishes</th>
              <th>Finish points</th>
              <th>Placement</th>
              <th>Placement points</th>
              <th>Total points</th>
            </tr>
          </thead>
          <tbody>
            {detail.teams.map((team) => {
              const problem = team.placementDuplicate ? 'duplicate' : team.placement === null && match.status !== 'planned' ? 'missing' : '';
              const status = statuses[`team:${team.teamId}`];
              const rowClasses = [problem ? `row-${problem}` : '', status?.state ? `row-${status.state}` : ''].filter(Boolean).join(' ');
              return (
                <tr key={team.teamId} className={rowClasses}>
                  <td className="col-rank">{team.matchRank}</td>
                  <td>
                    <div className="team-cell">
                      <TeamLogo team={team} />
                      <span className="team-name">{team.name}</span>
                      {!team.active && <span className="badge badge-muted">Inactive</span>}
                    </div>
                    <RowStatus status={status} />
                  </td>
                  <td className="col-wwcd">{team.isWwcd && <span className="badge badge-final wwcd-badge">WWCD</span>}</td>
                  <td>
                    <FinishStepper team={team} canScore={canScore} runFor={runFor} matchId={matchId} />
                  </td>
                  <td className="num">{team.finishPoints}</td>
                  <td>
                    <PlacementSelect
                      team={team}
                      problem={problem}
                      canScore={canScore}
                      busy={busy}
                      options={placementOptions}
                      holderByPlacement={holderByPlacement}
                      allowDuplicates={allowDuplicates}
                      onChange={changePlacement}
                    />
                  </td>
                  <td className="num">{team.placementPoints}</td>
                  <td className="num total">{team.totalPoints}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>All teams</td>
              <td>{finishTotal}</td>
              <td className="num">{detail.teams.reduce((sum, team) => sum + team.finishPoints, 0)}</td>
              <td />
              <td className="num">{detail.teams.reduce((sum, team) => sum + team.placementPoints, 0)}</td>
              <td className="num">{detail.teams.reduce((sum, team) => sum + team.totalPoints, 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Panel>
  );
}

export default function MatchControls({ state, run, busy, runFor, statuses }) {
  return (
    <div className="panel-stack scoring-workspace">
      <MatchBar state={state} run={run} busy={busy} />
      <TeamScoring state={state} busy={busy} runFor={runFor} statuses={statuses} />
    </div>
  );
}
