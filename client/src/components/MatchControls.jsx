import { useState } from 'react';
import { api } from '../services/api.js';
import { describeMatch, formatClockTime, makeRequestId, MATCH_STATUS_LABELS } from '../utils/formatters.js';
import EmptyState from './EmptyState.jsx';

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

function FinishEntry({ state, run, busy }) {
  const detail = state.currentMatch;
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [selectedPlayerId, setSelectedPlayerId] = useState('');

  const allowUnattributed = state.config.scoring.allowUnattributedFinishes;
  const activeTeams = state.teams.filter((team) => team.active);
  const teamPlayers = state.players.filter((player) => player.active && String(player.teamId) === selectedTeamId);
  const canScore = detail?.match.status === 'in_progress';
  const canAdd = canScore && selectedTeamId !== '' && (selectedPlayerId !== '' || allowUnattributed);

  function addFinish() {
    run(() =>
      api.addFinish(detail.match.id, {
        teamId: Number(selectedTeamId),
        playerId: selectedPlayerId === '' ? null : Number(selectedPlayerId),
        requestId: makeRequestId(),
      }),
    );
  }

  const recentFinishes = detail?.finishEvents.slice(0, 12) ?? [];
  return (
    <section className="panel">
      <h2>Finish entry</h2>
      {!canScore && <p className="muted">Start the current match to record finishes.</p>}
      <div className="form-row">
        <label>
          Team
          <select
            value={selectedTeamId}
            onChange={(event) => {
              setSelectedTeamId(event.target.value);
              setSelectedPlayerId('');
            }}
          >
            <option value="">Select team</option>
            {activeTeams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Player
          <select value={selectedPlayerId} onChange={(event) => setSelectedPlayerId(event.target.value)} disabled={selectedTeamId === ''}>
            <option value="">{allowUnattributed ? 'Unattributed' : 'Select player'}</option>
            {teamPlayers.map((player) => (
              <option key={player.id} value={player.id}>
                {player.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="button-large" disabled={busy || !canAdd} onClick={addFinish}>
          +1 Finish
        </button>
        <button
          type="button"
          className="button-secondary"
          disabled={busy || detail?.lastUndoableFinishEventId == null}
          onClick={() => run(() => api.undoFinish(detail.lastUndoableFinishEventId))}
        >
          Undo last finish
        </button>
      </div>
      {selectedTeamId !== '' && teamPlayers.length === 0 && (
        <p className="form-message-warning">This team has no active players. Add players in the Roster tab.</p>
      )}

      <h3>Recent finishes</h3>
      {recentFinishes.length === 0 ? (
        <EmptyState title="No finishes recorded yet" />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Team</th>
              <th>Player</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {recentFinishes.map((finish) => {
              const team = state.teams.find((candidate) => candidate.id === finish.teamId);
              const sameTeamPlayers = state.players.filter((player) => player.active && player.teamId === finish.teamId && player.id !== finish.playerId);
              const isReversed = finish.reversedAt !== null;
              return (
                <tr key={finish.id} className={isReversed ? 'row-reversed' : ''}>
                  <td>{formatClockTime(finish.createdAt)}</td>
                  <td>{team?.name ?? finish.teamId}</td>
                  <td>{finish.playerName ?? 'Unattributed'}</td>
                  <td>
                    {isReversed ? (
                      <span className="muted">undone</span>
                    ) : (
                      <>
                        <button type="button" className="button-secondary" disabled={busy || !canScore} onClick={() => run(() => api.undoFinish(finish.id))}>
                          Undo
                        </button>{' '}
                        <select
                          aria-label="Correct player"
                          value=""
                          disabled={busy || !canScore || sameTeamPlayers.length === 0}
                          onChange={(event) => run(() => api.correctFinish(finish.id, Number(event.target.value)))}
                        >
                          <option value="">Change player...</option>
                          {sameTeamPlayers.map((player) => (
                            <option key={player.id} value={player.id}>
                              {player.name}
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ScoreSummary({ state, run, busy }) {
  const detail = state.currentMatch;
  if (!detail) return null;
  const canScore = detail.match.status === 'in_progress';
  const placementOptions = Array.from({ length: detail.teams.filter((team) => team.active).length }, (_, index) => index + 1);

  function changePlacement(team, value) {
    if (value === '') run(() => api.clearPlacement(detail.match.id, team.teamId));
    else run(() => api.setPlacement(detail.match.id, team.teamId, Number(value)));
  }

  return (
    <section className="panel">
      <h2>Team scores - {describeMatch(detail.match)}</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Team</th>
            <th>Finishes</th>
            <th>Placement</th>
            <th>WWCD</th>
            <th>Placement pts</th>
            <th>Finish pts</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {detail.teams.map((team) => (
            <tr key={team.teamId}>
              <td>{team.name}</td>
              <td>{team.finishCount}</td>
              <td>
                <select
                  aria-label={`Placement for ${team.name}`}
                  value={team.placement ?? ''}
                  disabled={busy || !canScore}
                  onChange={(event) => changePlacement(team, event.target.value)}
                >
                  <option value="">-</option>
                  {placementOptions.map((placement) => (
                    <option key={placement} value={placement}>
                      {placement}
                    </option>
                  ))}
                </select>
              </td>
              <td>{team.isWwcd ? 'Yes' : ''}</td>
              <td>{team.placementPoints}</td>
              <td>{team.finishPoints}</td>
              <td>
                <strong>{team.totalPoints}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function MatchControls({ state, run, busy }) {
  return (
    <div className="panel-stack">
      <MatchPicker state={state} run={run} busy={busy} />
      <FinishEntry state={state} run={run} busy={busy} />
      <ScoreSummary state={state} run={run} busy={busy} />
    </div>
  );
}
