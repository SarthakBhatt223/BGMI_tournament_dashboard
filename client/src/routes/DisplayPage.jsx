import AmbientVideo from '../components/AmbientVideo.jsx';
import { FullLeaderboard, ScrollingLeaderboard } from '../components/Leaderboard.jsx';
import MvpShowcase from '../components/MvpShowcase.jsx';
import { useTournamentState } from '../hooks/useTournamentState.js';
import { describeMatch, formatClockTime } from '../utils/formatters.js';

function DisplayHeader({ state, title }) {
  const { broadcast, currentMatch, event, config } = state;
  const headline = broadcast.headlineText || event.name;
  const subtitle = broadcast.subtitleText || config.branding.tagline;
  return (
    <header className="display-header">
      <div>
        <h1 className="display-title">{headline}</h1>
        {subtitle && <p className="display-subtitle">{subtitle}</p>}
      </div>
      <div className="display-header-side">
        <p className="display-section">{title}</p>
        {currentMatch && <p className="display-match">{describeMatch(currentMatch.match)}</p>}
      </div>
    </header>
  );
}

function StaleIndicator({ connection, state }) {
  if (connection === 'connected') return null;
  return (
    <div className="stale-indicator" role="status">
      {connection === 'connecting' ? 'Connecting...' : 'Connection lost'}
      {state && ` - last update ${formatClockTime(state.generatedAt)}`}
    </div>
  );
}

export default function DisplayPage() {
  const { state, connection } = useTournamentState();
  const mode = state?.broadcast.mode ?? 'ambient';

  return (
    <div className="display-root">
      <AmbientVideo media={state?.media} />
      {state && mode === 'standings' && (
        <main className="display-panel">
          <DisplayHeader state={state} title="Standings" />
          {state.broadcast.leaderboardLayout === 'scrolling' ? (
            <ScrollingLeaderboard
              pages={state.standingsPages}
              currentPageIndex={state.leaderboard.currentPageIndex}
              teamsPerPage={state.leaderboard.teamsPerPage}
              rotateWhileVisible={state.leaderboard.rotatePagesWhileVisible}
              intervalSeconds={state.broadcast.scrollIntervalSeconds}
            />
          ) : (
            <FullLeaderboard standings={state.standings} />
          )}
        </main>
      )}
      {state && mode === 'mvp' && (
        <main className="display-panel">
          <DisplayHeader state={state} title="MVP" />
          <MvpShowcase mvp={state.mvp} topFraggers={state.topFraggers} />
        </main>
      )}
      <StaleIndicator connection={connection} state={state} />
    </div>
  );
}
