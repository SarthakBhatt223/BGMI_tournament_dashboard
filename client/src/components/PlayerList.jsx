import { useState } from 'react';
import EmptyState from './EmptyState.jsx';

// Player statistics with search by player or team name. Ranks come from the server.
export default function PlayerList({ playerStats }) {
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();
  const visiblePlayers = needle
    ? playerStats.filter((player) => [player.name, player.inGameName ?? '', player.teamName].some((text) => text.toLowerCase().includes(needle)))
    : playerStats;

  return (
    <section className="panel">
      <h2>Player statistics</h2>
      <label>
        Search player or team
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
      {visiblePlayers.length === 0 ? (
        <EmptyState title={playerStats.length === 0 ? 'No players registered' : 'No player matches the search'} />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Player</th>
              <th>Team</th>
              <th>Total finishes</th>
              <th>By match</th>
            </tr>
          </thead>
          <tbody>
            {visiblePlayers.map((player) => (
              <tr key={player.playerId}>
                <td>{player.rank}</td>
                <td>
                  {player.name}
                  {player.inGameName ? <span className="muted"> ({player.inGameName})</span> : null}
                </td>
                <td>{player.teamName}</td>
                <td>{player.totalFinishes}</td>
                <td className="muted">{player.matchFinishes.map((entry) => `M${entry.matchNumber}: ${entry.finishCount}`).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
