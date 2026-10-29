import { useState } from 'react';
import { teamInitials } from '../utils/formatters.js';

// Shows the team logo, or a neutral box with initials when there is none (or it fails to load).
export default function TeamLogo({ team }) {
  const [loadFailed, setLoadFailed] = useState(false);
  if (team.logoPath && !loadFailed) {
    return <img className="team-logo" src={team.logoPath} alt="" onError={() => setLoadFailed(true)} />;
  }
  return (
    <span className="team-logo team-logo-placeholder" aria-hidden="true">
      {teamInitials(team)}
    </span>
  );
}
