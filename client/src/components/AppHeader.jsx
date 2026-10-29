import ConnectionStatus from './ConnectionStatus.jsx';

export default function AppHeader({ eventName, connection, onSignOut }) {
  return (
    <header className="app-header">
      <div>
        <h1 className="app-header-title">{eventName ?? 'Tournament admin'}</h1>
        <p className="app-header-subtitle">Admin panel</p>
      </div>
      <div className="app-header-status">
        <ConnectionStatus connection={connection} />
        {onSignOut && (
          <button type="button" className="button-secondary" onClick={onSignOut}>
            Sign out
          </button>
        )}
      </div>
    </header>
  );
}
