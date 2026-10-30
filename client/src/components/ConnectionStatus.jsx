const LABELS = {
  connected: 'Live link',
  connecting: 'Connecting',
  disconnected: 'Link lost - data may be out of date',
};

export default function ConnectionStatus({ connection }) {
  return (
    <span className={`status-chip connection-${connection}`} role="status">
      <span className="status-dot" aria-hidden="true" />
      {LABELS[connection]}
    </span>
  );
}
