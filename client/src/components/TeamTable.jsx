import EmptyState from './EmptyState.jsx';
import TeamLogo from './TeamLogo.jsx';

// Standings as the server calculated them. Used by the admin dashboard and the display.
export default function TeamTable({ rows, className = '' }) {
  if (rows.length === 0) {
    return <EmptyState title="No teams yet">Add teams in the Roster tab.</EmptyState>;
  }
  return (
    <table className={`standings-table ${className}`}>
      <thead>
        <tr>
          <th className="col-rank">#</th>
          <th className="col-team">Team</th>
          <th className="col-number">WWCD</th>
          <th className="col-number">Placement</th>
          <th className="col-number">Finish</th>
          <th className="col-number">Total</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.teamId} className={row.rank <= 3 ? `top-rank top-rank-${row.rank}` : ''}>
            <td className="col-rank">{row.rank}</td>
            <td className="col-team">
              <TeamLogo team={row} />
              <span className="team-name">{row.name}</span>
            </td>
            <td className="col-number">{row.wwcd}</td>
            <td className="col-number">{row.placementPoints}</td>
            <td className="col-number">{row.finishPoints}</td>
            <td className="col-number col-total">{row.totalPoints}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
