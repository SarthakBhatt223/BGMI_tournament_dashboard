import TeamLogo from './TeamLogo.jsx';

// Shared building blocks of every standings board (full, compact and the scheduled overlay).
// The standings grid shared by the full leaderboard, the compact leaderboard and the scheduled
// overlay. `slots` reserves room for that many rows, so a short last page keeps the same row
// height as the full pages. `--row-count` also drives the text size, so 20 rows and 10 rows both
// fill the board without scrolling.
export function LeaderboardRows({ rows, slots = rows.length }) {
  return (
    <div className="leaderboard-grid" style={{ '--row-count': Math.max(slots, rows.length) }}>
      <div className="leaderboard-row leaderboard-head">
        <span className="cell-rank">#</span>
        <span className="cell-team">Team</span>
        <span className="cell-number">WWCD</span>
        <span className="cell-number">Place pts</span>
        <span className="cell-number">Finish pts</span>
        <span className="cell-number">Total</span>
      </div>
      {rows.map((row) => (
        <div key={row.teamId} className={`leaderboard-row ${row.rank <= 3 ? `top-rank top-rank-${row.rank}` : ''}`}>
          <span className="cell-rank">{row.rank}</span>
          <span className="cell-team">
            <TeamLogo team={row} />
            <span className="team-name" title={row.name}>{row.name}</span>
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

export function BoardTitle({ children, side }) {
  return (
    <div className="board-title">
      <h2>{children}</h2>
      {side && <span className="board-title-side">{side}</span>}
    </div>
  );
}

export function PageIndicator({ page, total }) {
  return (
    <div className="page-indicator">
      <span className="page-dots" aria-hidden="true">
        {Array.from({ length: total }, (_, index) => (
          <i key={index} className={index + 1 === page ? 'dot-active' : ''} />
        ))}
      </span>
      <span>Page {page} of {total}</span>
    </div>
  );
}
