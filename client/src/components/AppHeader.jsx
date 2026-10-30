import ConnectionStatus from './ConnectionStatus.jsx';

// Branding on the left; connection, system status and sign-out on the right.
// `systemStatus` is a short plain-text summary derived from server state by the caller.
export default function AppHeader({ eventName, connection, systemStatus, onSignOut }) {
  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <div>
          <h1 className="app-header-title">{eventName ?? 'Tournament'}</h1>
          <p className="app-header-subtitle">Tournament Control</p>
        </div>
      </div>
      <div className="app-header-status">
        <ConnectionStatus connection={connection} />
        {systemStatus && <span className="status-chip">{systemStatus}</span>}
        {onSignOut && (
          <button type="button" className="button-secondary" onClick={onSignOut}>
            Sign out
          </button>
        )}
      </div>
    </header>
  );
}
