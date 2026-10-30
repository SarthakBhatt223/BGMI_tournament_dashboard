import { formatClockTime } from '../utils/formatters.js';

// Hidden while connected. Otherwise small and in a corner, so it never covers the content. The
// last snapshot stays on screen; the time shows how old it is.
export default function DisplayConnection({ connection, state }) {
  if (connection === 'connected') return null;
  return (
    <div className="stale-indicator" role="status">
      <span className="status-dot" aria-hidden="true" />
      {connection === 'connecting' ? 'Connecting' : 'Connection lost'}
      {state && ` - last update ${formatClockTime(state.generatedAt)}`}
    </div>
  );
}
