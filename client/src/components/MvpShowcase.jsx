import MvpPortrait from './MvpPortrait.jsx';
import TeamLogo from './TeamLogo.jsx';

function TopFraggers({ fraggers, mvpPlayerId }) {
  if (fraggers.length === 0) return null;
  return (
    <section className="board mvp-fraggers">
      <h2 className="board-title-small">Most finishes</h2>
      <ol>
        {fraggers.map((player, index) => (
          <li key={player.playerId} className={player.playerId === mvpPlayerId ? 'fragger-mvp' : ''}>
            <span className="fragger-rank">{index + 1}</span>
            <span className="fragger-name">
              {player.inGameName || player.name}
              <span className="fragger-team">{player.teamName}</span>
            </span>
            <span className="fragger-count">{player.totalFinishes}</span>
          </li>
        ))}
      </ol>
      <p className="fragger-note">Supporting statistic. The MVP is chosen by the organizer.</p>
    </section>
  );
}

export default function MvpShowcase({ mvp, topFraggers, teams }) {
  if (!mvp) {
    return (
      <div className="mvp-stage">
        <section className="board mvp-empty">
          <div className="mvp-title mvp-title-idle">MVP</div>
          <h2>To be announced</h2>
          <p>The organizer will announce the MVP.</p>
        </section>
        <TopFraggers fraggers={topFraggers} mvpPlayerId={null} />
      </div>
    );
  }
  const team = teams.find((entry) => entry.id === mvp.teamId) ?? { name: mvp.teamName };
  // The in-game name is the headline; the registered name is shown below it only when it differs.
  const headline = mvp.inGameName || mvp.name;
  const realName = mvp.inGameName && mvp.inGameName !== mvp.name ? mvp.name : null;
  return (
    <div className="mvp-stage">
      <section className="board mvp-card">
        <MvpPortrait playerId={mvp.playerId} name={headline} />
        <div className="mvp-info">
          <div className="mvp-title">MVP</div>
          <p className="mvp-label">Most valuable player</p>
          <h2 className="mvp-name">{headline}</h2>
          {realName && <p className="mvp-ign">{realName}</p>}
          <p className="mvp-team">
            <TeamLogo team={team} />
            <span>{mvp.teamName}</span>
          </p>
          <div className="mvp-total">
            <span className="mvp-total-number">{mvp.totalFinishes}</span>
            <span className="mvp-total-label">Total finishes</span>
          </div>
          {mvp.matchFinishes.length > 0 && (
            <ul className="mvp-matches">
              {mvp.matchFinishes.map((entry) => (
                <li key={entry.matchId}>
                  <span>M{entry.matchNumber}</span>
                  <strong>{entry.finishCount}</strong>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <TopFraggers fraggers={topFraggers} mvpPlayerId={mvp.playerId} />
    </div>
  );
}
