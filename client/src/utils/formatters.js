export function formatClockTime(isoTimestamp) {
  if (!isoTimestamp) return '';
  return new Date(isoTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function describeMatch(match) {
  if (!match) return 'None';
  return match.label ? `Match ${match.matchNumber} - ${match.label}` : `Match ${match.matchNumber}`;
}

export const MATCH_STATUS_LABELS = {
  planned: 'planned',
  in_progress: 'in progress',
  finalized: 'finalized',
};

export const BROADCAST_MODE_LABELS = {
  ambient: 'Ambient video',
  standings: 'Leaderboard',
  mvp: 'MVP showcase',
};

// crypto.randomUUID only exists in secure contexts (https or localhost). A second device
// opening http://<host-LAN-address> is not one, so fall back to a random string.
export function makeRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function teamInitials(team) {
  return (team.shortName || team.name || '?').slice(0, 3).toUpperCase();
}
