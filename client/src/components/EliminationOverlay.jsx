import TeamLogo from './TeamLogo.jsx';

// Lower-third notification: "<team> eliminated by <team>". Works over every display mode.
// Both team identities are large (logo + name); the label sits on its own solid chip above each
// name so it can be read from the back of the room. Teams without a logo show their initials.
export default function EliminationOverlay({ event, leaving }) {
  if (!event) return null;
  const player = event.creditedPlayer;
  return (
    <div className={`elim-layer ${leaving ? 'elim-leaving' : ''}`} role="status" aria-live="polite">
      <div className="elim-card" key={event.id}>
        <div className="elim-tag">
          <span className="elim-tag-title">Elimination</span>
          <span className="elim-tag-match">Match {event.matchNumber}</span>
        </div>
        <div className="elim-body">
          <div className="elim-side elim-out">
            <TeamLogo team={event.eliminatedTeam} />
            <div className="elim-names">
              <span className="elim-label">Eliminated</span>
              <strong className="elim-team">{event.eliminatedTeam.name}</strong>
            </div>
          </div>
          <div className="elim-arrow" aria-hidden="true">&raquo;</div>
          <div className="elim-side elim-by">
            <TeamLogo team={event.creditedTeam} />
            <div className="elim-names">
              <span className="elim-label">Eliminated by</span>
              <strong className="elim-team">{event.creditedTeam.name}</strong>
              {player && <span className="elim-player">{player.inGameName || player.name}</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
