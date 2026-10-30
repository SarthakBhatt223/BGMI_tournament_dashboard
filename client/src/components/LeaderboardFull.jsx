import EmptyState from './EmptyState.jsx';
import { BoardTitle, LeaderboardRows } from './LeaderboardRows.jsx';

// All teams on one board (20 teams fit at 1920x1080 and 1366x768). Rank order comes from the server.
export default function LeaderboardFull({ standings }) {
  if (standings.length === 0) return <EmptyState title="No teams registered" />;
  return (
    <section className="board">
      <BoardTitle side={`${standings.length} teams`}>Overall standings</BoardTitle>
      <LeaderboardRows rows={standings} />
    </section>
  );
}
