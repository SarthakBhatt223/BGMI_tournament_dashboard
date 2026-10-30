import { useEffect, useState } from 'react';
import EmptyState from './EmptyState.jsx';
import { BoardTitle, LeaderboardRows, PageIndicator } from './LeaderboardRows.jsx';

// Compact leaderboard. The server decides which page belongs to this appearance
// (`currentPageIndex`), so every display and every reload shows the same page and the next
// appearance shows the next one. With `rotateWhileVisible` it also flips pages by itself.
export default function LeaderboardCompact({ pages, currentPageIndex, teamsPerPage, rotateWhileVisible, intervalSeconds }) {
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
    <section className="board">
      <BoardTitle
        side={pages.length > 1 && `Ranks ${rows[0].rank}-${rows[rows.length - 1].rank}`}
      >
        Overall standings
      </BoardTitle>
      <div key={visiblePageIndex} className="page-fade">
        <LeaderboardRows rows={rows} slots={teamsPerPage} />
      </div>
      {pages.length > 1 && <PageIndicator page={visiblePageIndex + 1} total={pages.length} />}
    </section>
  );
}
