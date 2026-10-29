import EmptyState from './EmptyState.jsx';

// Neutral geometric stand-in for a player portrait (no generated artwork).
function PortraitPlaceholder() {
  return (
    <svg className="mvp-portrait" viewBox="0 0 120 120" role="img" aria-label="No player photo">
      <rect width="120" height="120" fill="currentColor" opacity="0.12" />
      <circle cx="60" cy="46" r="20" fill="currentColor" opacity="0.4" />
      <path d="M20 110 C20 80 40 72 60 72 C80 72 100 80 100 110 Z" fill="currentColor" opacity="0.4" />
    </svg>
  );
}

function TopFraggers({ fraggers }) {
  if (fraggers.length === 0) return null;
  return (
    <section className="top-fraggers">
      <h2>Most finishes (supporting statistic)</h2>
      <ol>
        {fraggers.map((player) => (
          <li key={player.playerId}>
            <span className="fragger-name">{player.name}</span>
            <span className="fragger-team">{player.teamName}</span>
            <span className="fragger-count">{player.totalFinishes}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function MvpShowcase({ mvp, topFraggers }) {
  if (!mvp) {
    return (
      <div className="mvp-layout">
        <EmptyState title="MVP not selected yet">The organizer will announce the MVP.</EmptyState>
        <TopFraggers fraggers={topFraggers} />
      </div>
    );
  }
  return (
    <div className="mvp-layout">
      <section className="mvp-card">
        <PortraitPlaceholder />
        <div>
          <p className="mvp-label">MVP</p>
          <h2 className="mvp-name">{mvp.name}</h2>
          {mvp.inGameName && <p className="mvp-ign">{mvp.inGameName}</p>}
          <p className="mvp-team">{mvp.teamName}</p>
          <p className="mvp-total">
            <span className="mvp-total-number">{mvp.totalFinishes}</span> finishes
          </p>
          {mvp.matchFinishes.length > 0 && (
            <ul className="mvp-matches">
              {mvp.matchFinishes.map((entry) => (
                <li key={entry.matchId}>
                  Match {entry.matchNumber}: {entry.finishCount}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <TopFraggers fraggers={topFraggers} />
    </div>
  );
}
