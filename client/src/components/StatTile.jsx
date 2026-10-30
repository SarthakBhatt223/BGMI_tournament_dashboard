// A compact metric: small label, large value, optional detail line. `tone` colours the value
// ('ok' | 'warn' | 'bad').
export default function StatTile({ label, value, detail, tone }) {
  return (
    <div className={`stat-tile${tone ? ` stat-${tone}` : ''}`}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {detail && <span className="stat-detail">{detail}</span>}
    </div>
  );
}
