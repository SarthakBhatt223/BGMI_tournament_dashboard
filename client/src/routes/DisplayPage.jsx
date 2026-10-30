import AmbientScene from '../components/AmbientScene.jsx';
import DisplayConnection from '../components/DisplayConnection.jsx';
import DisplayHeader from '../components/DisplayHeader.jsx';
import EliminationOverlay from '../components/EliminationOverlay.jsx';
import LeaderboardCompact from '../components/LeaderboardCompact.jsx';
import LeaderboardFull from '../components/LeaderboardFull.jsx';
import MvpShowcase from '../components/MvpShowcase.jsx';
import ScheduledOverlay from '../components/ScheduledOverlay.jsx';
import { useEliminationNotices } from '../hooks/useEliminationNotices.js';
import { useTournamentState } from '../hooks/useTournamentState.js';
import { headlineOf, sceneOf, subtitleOf } from '../utils/displayScene.js';

// The whole display for one state snapshot. Kept separate from the data hooks so it can be
// rendered with any snapshot (tests, previews) and never has its own scoring or paging logic.
export function DisplayView({ state, connection, notice }) {
  const mode = sceneOf(state);

  return (
    <div className="display-root">
      <AmbientScene media={state?.media} title={state ? headlineOf(state) : ''} subtitle={state ? subtitleOf(state) : ''} active={mode === 'ambient'} />
      {state && mode === 'standings' && (
        <main className="display-panel">
          <DisplayHeader state={state} title="Standings" />
          {state.broadcast.leaderboardLayout === 'scrolling' ? (
            <LeaderboardCompact
              pages={state.standingsPages}
              currentPageIndex={state.leaderboard.currentPageIndex}
              teamsPerPage={state.leaderboard.teamsPerPage}
              rotateWhileVisible={state.leaderboard.rotatePagesWhileVisible}
              intervalSeconds={state.broadcast.scrollIntervalSeconds}
            />
          ) : (
            <LeaderboardFull standings={state.standings} />
          )}
        </main>
      )}
      {state && mode === 'mvp' && (
        <main className="display-panel">
          <DisplayHeader state={state} title="MVP" />
          <MvpShowcase mvp={state.mvp} topFraggers={state.topFraggers} teams={state.teams} />
        </main>
      )}
      {state && <ScheduledOverlay presentation={state.broadcast.presentation} generatedAt={state.generatedAt} />}
      <EliminationOverlay event={notice.current} leaving={notice.leaving} />
      <DisplayConnection connection={connection} state={state} />
    </div>
  );
}

export default function DisplayPage() {
  const { state, connection } = useTournamentState();
  const notice = useEliminationNotices();
  return <DisplayView state={state} connection={connection} notice={notice} />;
}
