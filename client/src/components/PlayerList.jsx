import { useState } from 'react';
import EmptyState from './EmptyState.jsx';
import Panel from './Panel.jsx';

// Player statistics with search by player or team name. Ranks come from the server.
export default function PlayerList({ playerStats }) {
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();
  const visiblePlayers = needle
    ? playerStats.filter((player) => [player.name, player.inGameName ?? '', player.teamName].some((text) => text.toLowerCase().includes(needle)))
    : playerStats;

  return (
    <Panel title="Player statistics" actions={<span className="muted">{visiblePlayers.length} of {playerStats.length} players</span>}>
      <label className="search-field">
        Search player or team
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
      {visiblePlayers.length === 0 ? (
        <EmptyState title={playerStats.length === 0 ? 'No players registered' : 'No player matches the search'} />
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th className="col-rank">Rank</th>
              <th>Player</th>
              <th>In-game name</th>
              <th>Team</th>
              <th className="col-number">Finishes</th>
              <th>By match</th>
            </tr>
          </thead>
          <tbody>
            {visiblePlayers.map((player) => (
              <tr key={player.playerId}>
                <td className="col-rank">{player.rank}</td>
                <td>{player.name}</td>
                <td className="muted">{player.inGameName || '-'}</td>
                <td>{player.teamName}</td>
                <td className="col-number num total">{player.totalFinishes}</td>
                <td>
                  <span className="chip-row">
                    {player.matchFinishes.map((entry) => (
                      <span key={entry.matchNumber} className="chip">M{entry.matchNumber} <strong>{entry.finishCount}</strong></span>
                    ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
