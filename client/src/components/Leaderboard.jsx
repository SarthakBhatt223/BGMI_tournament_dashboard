import { useEffect, useState } from 'react';
import EmptyState from './EmptyState.jsx';
import TeamLogo from './TeamLogo.jsx';

// `slots` reserves room for that many rows, so a short last page keeps the same row height as the
// full pages instead of stretching its few rows over the whole screen.
function LeaderboardRows({ rows, slots = rows.length }) {
  return (
    <div className="leaderboard-grid" style={{ '--row-count': Math.max(slots, rows.length) }}>
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

// Compact leaderboard. The server decides which page belongs to this appearance
// (`currentPageIndex`), so every display and every reload shows the same page and the next
// appearance shows the next one. With `rotateWhileVisible` it also flips pages by itself.
export function ScrollingLeaderboard({ pages, currentPageIndex, teamsPerPage, rotateWhileVisible, intervalSeconds }) {
  const [offset, setOffset] = useState(0);

  // A new appearance (or a manual "next page") starts again from the page the server chose.
  useEffect(() => setOffset(0), [currentPageIndex]);

  useEffect(() => {
    if (!rotateWhileVisible || pages.length <= 1) return undefined;
    const timer = setInterval(() => setOffset((current) => current + 1), intervalSeconds * 1000);
    return () => clearInterval(timer);
  }, [rotateWhileVisible, pages.length, intervalSeconds]);

  if (pages.length === 0) return <EmptyState title="No teams registered" />;
  const visiblePageIndex = (currentPageIndex + offset) % pages.length;
  const rows = pages[visiblePageIndex];
  return (
    <div className="scrolling-leaderboard">
      <div key={visiblePageIndex} className="page-fade">
        <LeaderboardRows rows={rows} slots={teamsPerPage} />
      </div>
      {pages.length > 1 && (
        <p className="page-indicator">
          Ranks {rows[0].rank}-{rows[rows.length - 1].rank} - Page {visiblePageIndex + 1} of {pages.length}
        </p>
      )}
    </div>
  );
}
