export default function ErrorBanner({ error, onDismiss }) {
  if (!error) return null;
  return (
    <div className="error-banner" role="alert">
      <div>
        <strong>{error.message}</strong>
        {Array.isArray(error.details) && (
          <ul>
            {error.details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        )}
      </div>
      <button type="button" className="button-secondary" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}
