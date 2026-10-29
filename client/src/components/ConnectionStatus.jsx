const LABELS = {
  connected: 'Connected',
  connecting: 'Connecting...',
  disconnected: 'Disconnected - data may be out of date',
};

export default function ConnectionStatus({ connection }) {
  return (
    <span className={`connection-status connection-${connection}`} role="status">
      {LABELS[connection]}
    </span>
  );
}
