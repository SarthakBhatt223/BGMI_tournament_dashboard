import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api.js';
import { formatClockTime, makeRequestId } from '../utils/formatters.js';
import Panel from './Panel.jsx';
import TeamLogo from './TeamLogo.jsx';

// Records "team A was eliminated by team B" for the display's notification. It is a broadcast and
// audit record only: it never changes finishes or points (those are entered in Scoring).
export default function EliminationPanel({ state, run, busy }) {
  const match = state.currentMatch?.match ?? null;
  const activeTeams = state.teams.filter((team) => team.active);
  const [eliminatedTeamId, setEliminatedTeamId] = useState('');
  const [creditedTeamId, setCreditedTeamId] = useState('');
  const [creditedPlayerId, setCreditedPlayerId] = useState('');
  const [history, setHistory] = useState([]);
  const [historyError, setHistoryError] = useState('');
  // One id per form submission: a double click or retry re-sends the same id, which the server
  // treats as the same event. It changes only after a successful recording.
  const requestIdRef = useRef(makeRequestId());

  const creditedPlayers = state.players.filter((player) => player.active && String(player.teamId) === creditedTeamId);
  const eliminatedTeam = activeTeams.find((team) => String(team.id) === eliminatedTeamId);
  const creditedTeam = activeTeams.find((team) => String(team.id) === creditedTeamId);
  const sameTeam = eliminatedTeamId !== '' && eliminatedTeamId === creditedTeamId;
  const canRecord = match !== null && eliminatedTeam && creditedTeam && !sameTeam;

  const matchId = match?.id ?? null;
  const loadHistory = useCallback(async () => {
    if (matchId === null) {
      setHistory([]);
      return;
    }
    try {
      const data = await api.listEliminations(matchId);
      setHistory(data.eliminations);
      setHistoryError('');
    } catch (error) {
      setHistoryError(error.message);
    }
  }, [matchId]);

  // The server publishes a new snapshot after every recording or void, so refresh the list then.
  useEffect(() => {
    loadHistory();
  }, [loadHistory, state.generatedAt]);

  async function record(event) {
    event.preventDefault();
    if (!canRecord) return;
    const creditedPlayer = creditedPlayers.find((player) => String(player.id) === creditedPlayerId);
    const text = `Show on the live display:\n${eliminatedTeam.name} eliminated by ${creditedTeam.name}${creditedPlayer ? ` (${creditedPlayer.name})` : ''}?`;
    if (!window.confirm(text)) return;
    const outcome = await run(() =>
      api.recordElimination(match.id, {
        eliminatedTeamId: Number(eliminatedTeamId),
        creditedTeamId: Number(creditedTeamId),
        creditedPlayerId: creditedPlayerId === '' ? undefined : Number(creditedPlayerId),
        requestId: requestIdRef.current,
      }),
    );
    if (outcome.ok) {
      requestIdRef.current = makeRequestId();
      setEliminatedTeamId('');
      setCreditedPlayerId('');
    }
  }

  function voidEvent(entry) {
    const reason = window.prompt(`Void "${entry.eliminatedTeam.name} eliminated by ${entry.creditedTeam.name}"? Optional reason (kept in the history):`);
    if (reason === null) return; // cancelled
    run(() => api.voidElimination(match.id, entry.id, reason.trim() || undefined));
  }

  return (
    <Panel title="Elimination notification" actions={match && <span className="muted">Match {match.matchNumber}</span>}>
      {match === null ? (
        <p className="muted">Select a match in Scoring first.</p>
      ) : (
        <>
          <p className="muted">
            Shows a notification on the public display. It does not change any finishes or points; enter those in Scoring.
          </p>
          <form className="form-row" onSubmit={record}>
            <label>
              Eliminated team
              <select value={eliminatedTeamId} onChange={(event) => setEliminatedTeamId(event.target.value)} required>
                <option value="">Choose team</option>
                {activeTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
            </label>
            <label>
              Credited team
              <select
                value={creditedTeamId}
                onChange={(event) => {
                  setCreditedTeamId(event.target.value);
                  setCreditedPlayerId('');
                }}
                required
              >
                <option value="">Choose team</option>
                {activeTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
            </label>
            <label>
              Credited player (optional)
              <select value={creditedPlayerId} onChange={(event) => setCreditedPlayerId(event.target.value)} disabled={creditedTeamId === ''}>
                <option value="">No player</option>
                {creditedPlayers.map((player) => <option key={player.id} value={player.id}>{player.inGameName || player.name}</option>)}
              </select>
            </label>
            <button type="submit" disabled={busy || !canRecord}>Record and show</button>
          </form>
          {sameTeam && <p className="form-message-error">A team cannot eliminate itself.</p>}

          <h3>History</h3>
          {historyError && <p className="form-message-error">{historyError}</p>}
          {history.length === 0 ? (
            <p className="muted">No eliminations recorded for this match.</p>
          ) : (
            <ul className="elimination-list">
              {[...history].reverse().map((entry) => (
                <li key={entry.id} className={entry.status === 'voided' ? 'elimination-voided' : ''}>
                  <span className="elimination-time">{formatClockTime(entry.createdAt)}</span>
                  <span className="elimination-text">
                    <TeamLogo team={entry.eliminatedTeam} /> <strong>{entry.eliminatedTeam.name}</strong>
                    <span className="muted"> eliminated by </span>
                    <TeamLogo team={entry.creditedTeam} /> <strong>{entry.creditedTeam.name}</strong>
                    {entry.creditedPlayer && <span className="muted"> ({entry.creditedPlayer.inGameName || entry.creditedPlayer.name})</span>}
                  </span>
                  {entry.status === 'voided' ? (
                    <span className="badge badge-muted">Voided</span>
                  ) : (
                    <button type="button" className="button-danger" disabled={busy} onClick={() => voidEvent(entry)}>Void</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  );
}
