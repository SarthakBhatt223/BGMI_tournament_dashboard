import { useEffect, useState } from 'react';
import { useServerCountdown } from '../hooks/useServerCountdown.js';
import { BoardTitle, LeaderboardRows, PageIndicator } from './LeaderboardRows.jsx';

const EXIT_MS = 450;

// Fills with the time left; started part-way through if the page was opened mid-presentation.
function ProgressBar({ totalMs, remainingMs }) {
  const [initial] = useState(() => ({ total: totalMs, elapsed: Math.max(0, totalMs - remainingMs) }));
  return (
    <div className="overlay-progress" aria-hidden="true">
      <div
        className="overlay-progress-fill"
        style={{ animationDuration: `${initial.total}ms`, animationDelay: `-${initial.elapsed}ms` }}
      />
    </div>
  );
}

// The server-driven scheduled leaderboard shown over the ambient screen. The server sets and
// clears `presentation`; this component only renders it and keeps it mounted for a short exit
// animation. The remaining time is measured against the server clock.
export default function ScheduledOverlay({ presentation, generatedAt }) {
  const remaining = useServerCountdown(presentation?.endsAt ?? null, generatedAt);
  const active = presentation && remaining > 0 ? presentation : null;
  const [shown, setShown] = useState(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (active) {
      setShown(active);
      setLeaving(false);
    }
  }, [active]);

  useEffect(() => {
    if (active || !shown) return undefined;
    setLeaving(true);
    const timer = setTimeout(() => {
      setShown(null);
      setLeaving(false);
    }, EXIT_MS);
    return () => clearTimeout(timer);
  }, [active, shown]);

  if (!shown) return null;
  const secondsLeft = Math.ceil((remaining ?? 0) / 1000);
  return (
    <div className={`overlay-layer ${leaving ? 'overlay-leaving' : ''}`} role="region" aria-label="Overall standings">
      <section className="board overlay-board">
        <BoardTitle side={shown.totalPages > 1 && `Ranks ${shown.standings[0]?.rank}-${shown.standings[shown.standings.length - 1]?.rank}`}>
          Overall standings
        </BoardTitle>
        <LeaderboardRows rows={shown.standings} slots={shown.teamsPerPage} />
        <div className="overlay-footer">
          {shown.totalPages > 1 ? <PageIndicator page={shown.page} total={shown.totalPages} /> : <span />}
          <span className="overlay-countdown">{secondsLeft > 0 ? `${secondsLeft}s` : ''}</span>
        </div>
        <ProgressBar key={shown.presentationId} totalMs={shown.displayDurationMs} remainingMs={remaining ?? shown.displayDurationMs} />
      </section>
    </div>
  );
}
