import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { statusText } from '../hooks/useKeyedActions.js';
import { api } from '../services/api.js';
import { describeMatch, makeRequestId, MATCH_STATUS_LABELS } from '../utils/formatters.js';

const STATUS_LABELS = { match: 'MATCH', mismatch: 'MISMATCH', incomplete: 'INCOMPLETE' };

function formatDifference(difference) {
  if (difference === 0) return '0';
  return difference > 0 ? `+${difference}` : String(difference);
}

function StatusChip({ status }) {
  return <span className={`audit-chip audit-chip-${status}`}>{STATUS_LABELS[status]}</span>;
}

function PlayerRow({ teamId, player, canEdit, onStep, status }) {
  const text = statusText(status);
  return (
    <li className="audit-player">
      <div className="audit-player-name">
        <span>{player.name}</span>
        <span className="audit-muted">
          {player.inGameName ? `ID: ${player.inGameName}` : 'No in-game ID'}
          {!player.onRoster && ' - no longer on the roster'}
        </span>
      </div>
      <div className="audit-stepper">
        <button type="button" className="audit-step" aria-label={`Remove one finish from ${player.name}`} disabled={!canEdit || player.finishes <= 0} onClick={() => onStep(teamId, player, -1)}>
          &minus;
        </button>
        <output className="audit-count" aria-label={`Finishes for ${player.name}`}>{player.finishes}</output>
        <button type="button" className="audit-step audit-step-primary" aria-label={`Add one finish to ${player.name}`} disabled={!canEdit} onClick={() => onStep(teamId, player, 1)}>
          +
        </button>
      </div>
      <span className={`audit-row-status audit-row-status-${status?.state ?? 'idle'}`} role="status" aria-live="polite">{text}</span>
    </li>
  );
}

function TeamAudit({ team, expanded, onToggle, canEdit, onStep, statuses }) {
  const panelId = `audit-team-${team.teamId}`;
  return (
    <li className={`audit-team audit-team-${team.status}`}>
      <button type="button" className="audit-team-head" aria-expanded={expanded} aria-controls={panelId} onClick={() => onToggle(team.teamId)}>
        <span className="audit-caret" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        <span className="audit-team-name">
          {team.name}
          {team.shortName && <span className="audit-tag">{team.shortName}</span>}
        </span>
        <span className="audit-figure">Team finishes: <strong>{team.teamFinishes}</strong></span>
        <span className="audit-figure">Player total: <strong>{team.playerTotal}</strong></span>
        {team.status === 'mismatch' && <span className="audit-figure audit-figure-diff">Difference: <strong>{formatDifference(team.difference)}</strong></span>}
        <StatusChip status={team.status} />
      </button>
      {expanded && (
        <div id={panelId} className="audit-team-body">
          {team.rosterIncomplete && (
            <p className="audit-note audit-note-warning">
              {team.activePlayerCount === 0
                ? 'No players are registered for this team, so its finishes cannot be verified.'
                : `Roster incomplete: ${team.activePlayerCount} of ${team.expectedPlayerCount} players registered. Finishes by an unregistered player cannot be entered.`}
            </p>
          )}
          {team.status === 'mismatch' && (
            <p className="audit-note audit-note-error">
              {team.difference > 0
                ? `${team.difference} team finish(es) are not yet assigned to a player.`
                : `Players have ${-team.difference} more finish(es) than the team total. Check the team total in the Scoring tab or the player counts.`}
            </p>
          )}
          {team.players.length === 0 ? (
            <p className="audit-muted">No players registered. Add players in the Roster tab.</p>
          ) : (
            <ul className="audit-players">
              {team.players.map((player) => (
                <PlayerRow key={player.playerId} teamId={team.teamId} player={player} canEdit={canEdit} onStep={onStep} status={statuses[`player:${player.playerId}`]} />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

export default function PlayerFinishAudit({ state, runFor, statuses, run, busy }) {
  const [selectedMatchId, setSelectedMatchId] = useState(null);
  const [audit, setAudit] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState('');
  const [expandedIds, setExpandedIds] = useState(() => new Set());

  // Without an explicit choice, follow the match used in Scoring; the choice here never changes
  // what the display shows.
  const fallbackMatchId = state.currentMatch?.match.id ?? state.matches.at(-1)?.id ?? null;
  const matchId = selectedMatchId !== null && state.matches.some((match) => match.id === selectedMatchId) ? selectedMatchId : fallbackMatchId;

  // Every response is applied only if it is newer than what is shown, so a slow older reply can
  // never overwrite fresher saved data, and a reply for another match is never mixed in.
  const appliedRef = useRef({ matchId: null, generatedAt: '' });
  const applyAudit = useCallback((next) => {
    const applied = appliedRef.current;
    if (applied.matchId === next.match.id && next.generatedAt < applied.generatedAt) return;
    appliedRef.current = { matchId: next.match.id, generatedAt: next.generatedAt };
    setAudit(next);
    setLoadError(null);
  }, []);

  useEffect(() => {
    if (matchId === null) {
      setAudit(null);
      return undefined;
    }
    let cancelled = false;
    api.getPlayerAudit(matchId)
      .then((next) => { if (!cancelled) applyAudit(next); })
      .catch((error) => { if (!cancelled) setLoadError(error); });
    return () => { cancelled = true; };
    // Reload on every pushed state update, so scoring-tab changes and other admins show up here.
  }, [matchId, state.generatedAt, applyAudit]);

  const showing = audit !== null && audit.match.id === matchId ? audit : null;
  const canEdit = showing?.canEdit === true;

  // Each click is its own request (new id). The count shown only changes once the server has
  // saved it and returned the recalculated audit.
  function step(teamId, player, delta) {
    runFor(`player:${player.playerId}`, async () => {
      const response = await api.adjustPlayerFinish(matchId, player.playerId, teamId, delta, makeRequestId());
      applyAudit(response.audit);
    });
  }

  function toggle(teamId) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  }

  const query = search.trim().toLowerCase();
  const visibleTeams = useMemo(() => {
    if (!showing) return [];
    if (query === '') return showing.teams;
    return showing.teams.filter((team) =>
      [team.name, team.shortName ?? '', ...team.players.flatMap((player) => [player.name, player.inGameName ?? ''])]
        .some((text) => text.toLowerCase().includes(query)),
    );
  }, [showing, query]);

  function reopen() {
    const reason = window.prompt('Why is this match being reopened? (recorded in the audit log)');
    if (reason && reason.trim()) run(() => api.reopenMatch(matchId, reason.trim()));
  }

  const summary = showing?.summary;
  return (
    <section className="audit-root" aria-label="Player Finish Audit">
      <header className="audit-header">
        <div>
          <h2>Player Finish Audit</h2>
          <p className="audit-muted">Enter each player&apos;s finishes from the official results. Team points are never changed here.</p>
        </div>
        <label className="audit-field">
          Match
          <select value={matchId ?? ''} onChange={(event) => setSelectedMatchId(event.target.value === '' ? null : Number(event.target.value))}>
            {state.matches.length === 0 && <option value="">No matches</option>}
            {state.matches.map((match) => (
              <option key={match.id} value={match.id}>{describeMatch(match)} ({MATCH_STATUS_LABELS[match.status]})</option>
            ))}
          </select>
        </label>
      </header>

      {loadError && <p className="audit-note audit-note-error" role="alert">Could not load the audit: {loadError.message}</p>}
      {matchId === null && <p className="audit-muted">Create a match in the Scoring tab first.</p>}

      {showing && (
        <>
          <div className="audit-summary">
            <div className="audit-summary-main">
              <span className="audit-summary-label">Teams reconciled</span>
              <strong className={summary.teamsReconciled === summary.teamsTotal && summary.teamsTotal > 0 ? 'audit-ok' : ''}>
                {summary.teamsReconciled}/{summary.teamsTotal}
              </strong>
            </div>
            <div><span className="audit-summary-label">Mismatched</span><strong className={summary.teamsMismatched > 0 ? 'audit-bad' : ''}>{summary.teamsMismatched}</strong></div>
            <div><span className="audit-summary-label">Incomplete</span><strong className={summary.teamsIncomplete > 0 ? 'audit-warn' : ''}>{summary.teamsIncomplete}</strong></div>
            <div><span className="audit-summary-label">Team finishes</span><strong>{summary.teamFinishesTotal}</strong></div>
            <div><span className="audit-summary-label">Player finishes</span><strong>{summary.playerFinishesTotal}</strong></div>
            <div><span className="audit-summary-label">Incomplete rosters</span><strong className={summary.teamsWithIncompleteRoster > 0 ? 'audit-warn' : ''}>{summary.teamsWithIncompleteRoster}</strong></div>
          </div>

          {showing.match.status === 'finalized' && (
            <div className="audit-note audit-note-warning audit-lock">
              <span>This match is finalized, so player finishes are locked. Reopening requires a reason and is recorded in the audit log.</span>
              <button type="button" className="audit-button" disabled={busy} onClick={reopen}>Reopen for correction</button>
            </div>
          )}
          {showing.match.status === 'planned' && <p className="audit-note audit-note-warning">This match has not started. Start it in the Scoring tab to enter player finishes.</p>}

          <label className="audit-search">
            <span className="audit-sr-only">Search teams or players</span>
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search team, tag, player or in-game ID" />
          </label>

          {visibleTeams.length === 0 ? (
            <p className="audit-muted">{query ? 'No team or player matches the search.' : 'No teams to show.'}</p>
          ) : (
            <ul className="audit-teams">
              {visibleTeams.map((team) => (
                <TeamAudit
                  key={team.teamId}
                  team={team}
                  expanded={expandedIds.has(team.teamId)}
                  onToggle={toggle}
                  canEdit={canEdit}
                  onStep={step}
                  statuses={statuses}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
