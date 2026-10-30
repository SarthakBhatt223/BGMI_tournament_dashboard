import { formatCountdown, useServerCountdown } from '../hooks/useServerCountdown.js';
import { BROADCAST_MODE_LABELS, describeMatch, MATCH_STATUS_LABELS } from '../utils/formatters.js';
import Panel from './Panel.jsx';
import StatTile from './StatTile.jsx';
import TeamTable from './TeamTable.jsx';

const PREVIEW_ROWS = 10;

// Everything shown here comes from the server snapshot; nothing is calculated for scoring.
function buildWarnings(state) {
  const warnings = [];
  const needed = state.config.roster.playersPerTeam;
  const incomplete = state.teams.filter((team) => team.active && team.playerCount < needed);
  if (incomplete.length > 0) {
    warnings.push({ id: 'roster', text: `${incomplete.length} team(s) have fewer than ${needed} players: ${incomplete.map((team) => team.name).join(', ')}.`, tab: 'roster', action: 'Fix roster' });
  }
  const detail = state.currentMatch;
  if (!detail) {
    warnings.push({ id: 'nomatch', text: 'No match is selected for scoring.', tab: 'scoring', action: 'Open scoring' });
  } else if (detail.match.status !== 'planned') {
    const missing = detail.summary.teamCount - detail.summary.placementsEntered;
    if (missing > 0) warnings.push({ id: 'missing', text: `${missing} team(s) have no placement in ${describeMatch(detail.match)}.`, tab: 'scoring', action: 'Open scoring' });
    if (detail.summary.duplicatePlacements.length > 0) {
      warnings.push({ id: 'dup', text: `Duplicate placements in ${describeMatch(detail.match)}.`, tab: 'scoring', action: 'Open scoring' });
    }
  }
  if (!state.media.ambientVideoAvailable) {
    warnings.push({ id: 'video', text: `Ambient video not found at ${state.media.ambientVideoUrl}. The display shows a dark fallback.`, tab: 'broadcast', action: 'Broadcast' });
  }
  return warnings;
}

export default function Dashboard({ state, connection, onOpenTab }) {
  const match = state.currentMatch?.match ?? null;
  const { broadcast, leaderboard } = state;
  const schedule = broadcast.schedule;
  const countdown = useServerCountdown(schedule?.enabled ? schedule.nextRunAt : null, state.generatedAt);
  const finalizedCount = state.matches.filter((entry) => entry.status === 'finalized').length;
  const warnings = buildWarnings(state);
  const layoutLabel = broadcast.leaderboardLayout === 'scrolling' ? 'Compact' : 'Full';

  return (
    <div className="panel-stack">
      <div className="stat-strip">
        <StatTile label="Teams" value={state.counts.teams} />
        <StatTile label="Players" value={state.counts.players} />
        <StatTile label="Matches" value={state.matches.length} detail={`${finalizedCount} finalized`} />
        <StatTile
          label="Current match"
          value={match ? `#${match.matchNumber}` : '-'}
          detail={match ? MATCH_STATUS_LABELS[match.status] : 'none selected'}
          tone={match?.status === 'in_progress' ? 'ok' : undefined}
        />
        <StatTile label="Display mode" value={BROADCAST_MODE_LABELS[broadcast.mode]} detail={broadcast.mode === 'standings' ? `${layoutLabel} layout` : undefined} />
        <StatTile
          label="Connection"
          value={connection === 'connected' ? 'Live' : connection === 'connecting' ? 'Connecting' : 'Lost'}
          tone={connection === 'connected' ? 'ok' : connection === 'connecting' ? 'warn' : 'bad'}
        />
      </div>

      <div className="dashboard-grid">
        <Panel
          title="Live standings"
          actions={<button type="button" className="button-secondary" onClick={() => onOpenTab('scoring')}>Open scoring</button>}
        >
          <TeamTable rows={state.standings} limit={PREVIEW_ROWS} />
          {state.standings.length > PREVIEW_ROWS && (
            <p className="muted dashboard-note">Showing the top {PREVIEW_ROWS} of {state.standings.length} teams.</p>
          )}
        </Panel>

        <div className="panel-stack">
          <Panel title="Quick actions">
            <div className="quick-actions">
              <button type="button" onClick={() => onOpenTab('scoring')}>Scoring</button>
              <button type="button" className="button-secondary" onClick={() => onOpenTab('audit')}>Finish audit</button>
              <button type="button" className="button-secondary" onClick={() => onOpenTab('roster')}>Roster</button>
              <button type="button" className="button-secondary" onClick={() => onOpenTab('broadcast')}>Broadcast</button>
            </div>
          </Panel>

          <Panel title="Broadcast">
            <dl className="info-strip">
              <div><dt>Showing now</dt><dd>{BROADCAST_MODE_LABELS[broadcast.mode]}</dd></div>
              {leaderboard.pageCount > 0 && (
                <div><dt>Compact page</dt><dd>{leaderboard.currentPageIndex + 1} of {leaderboard.pageCount}</dd></div>
              )}
              <div>
                <dt>Scheduled leaderboard</dt>
                <dd>
                  {!schedule?.enabled ? 'Off' : broadcast.presentation ? 'On screen now' : `Next in ${formatCountdown(countdown)}`}
                </dd>
              </div>
            </dl>
          </Panel>

          <Panel title="Warnings">
            {warnings.length === 0 ? (
              <p className="muted">No warnings.</p>
            ) : (
              <ul className="warning-list">
                {warnings.map((warning) => (
                  <li key={warning.id}>
                    <span>{warning.text}</span>
                    <button type="button" className="button-secondary" onClick={() => onOpenTab(warning.tab)}>{warning.action}</button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
