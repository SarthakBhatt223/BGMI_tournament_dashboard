import { useEffect, useState } from 'react';
import EmptyState from './EmptyState.jsx';
import TeamLogo from './TeamLogo.jsx';

function LeaderboardRows({ rows }) {
  return (
    <div className="leaderboard-grid" style={{ '--row-count': rows.length }}>
      <div className="leaderboard-row leaderboard-head">
        <span className="cell-rank">#</span>
        <span className="cell-team">Team</span>
        <span className="cell-number">WWCD</span>
        <span className="cell-number">Placement</span>
        <span className="cell-number">Finish</span>
        <span className="cell-number">Total</span>
      </div>
      {rows.map((row) => (
        <div key={row.teamId} className={`leaderboard-row ${row.rank <= 3 ? `top-rank top-rank-${row.rank}` : ''}`}>
          <span className="cell-rank">{row.rank}</span>
          <span className="cell-team">
            <TeamLogo team={row} />
            <span className="team-name">{row.name}</span>
          </span>
          <span className="cell-number">{row.wwcd}</span>
          <span className="cell-number">{row.placementPoints}</span>
          <span className="cell-number">{row.finishPoints}</span>
          <span className="cell-number cell-total">{row.totalPoints}</span>
        </div>
      ))}
    </div>
  );
}

export function FullLeaderboard({ standings }) {
  if (standings.length === 0) return <EmptyState title="No teams registered" />;
  return <LeaderboardRows rows={standings} />;
}

// Rotates through the pages prepared by the server. Unmounting (a mode change) resets it.
export function ScrollingLeaderboard({ pages, intervalSeconds }) {
  const [pageIndex, setPageIndex] = useState(0);

  useEffect(() => {
    if (pages.length <= 1) return undefined;
    const timer = setInterval(() => setPageIndex((index) => index + 1), intervalSeconds * 1000);
    return () => clearInterval(timer);
  }, [pages.length, intervalSeconds]);

  if (pages.length === 0) return <EmptyState title="No teams registered" />;
  const visiblePageIndex = pageIndex % pages.length;
  return (
    <div className="scrolling-leaderboard">
      <div key={visiblePageIndex} className="page-fade">
        <LeaderboardRows rows={pages[visiblePageIndex]} />
      </div>
      {pages.length > 1 && (
        <p className="page-indicator">
          Page {visiblePageIndex + 1} of {pages.length}
        </p>
      )}
    </div>
  );
}
