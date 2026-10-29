import { useState } from 'react';
import { api } from '../services/api.js';
import EmptyState from './EmptyState.jsx';
import TeamLogo from './TeamLogo.jsx';

function AddTeamForm({ run, busy }) {
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    const outcome = await run(() => api.createTeam({ name, shortName }));
    if (outcome.ok) {
      setName('');
      setShortName('');
    }
  }

  return (
    <form className="form-row" onSubmit={handleSubmit}>
      <label>
        Team name
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} required />
      </label>
      <label>
        Abbreviation (optional)
        <input value={shortName} onChange={(event) => setShortName(event.target.value)} maxLength={6} />
      </label>
      <button type="submit" disabled={busy}>
        Add team
      </button>
    </form>
  );
}

function TeamRow({ team, allTeams, players, run, busy, playersPerTeam }) {
  const [name, setName] = useState(team.name);
  const [shortName, setShortName] = useState(team.shortName ?? '');
  const [newPlayerName, setNewPlayerName] = useState('');
  const hasChanges = name !== team.name || shortName !== (team.shortName ?? '');
  const teamPlayers = players.filter((player) => player.teamId === team.id);
  const activePlayerCount = teamPlayers.filter((player) => player.active).length;

  async function addPlayer(event) {
    event.preventDefault();
    const outcome = await run(() => api.createPlayer({ teamId: team.id, name: newPlayerName }));
    if (outcome.ok) setNewPlayerName('');
  }

  return (
    <li className={`team-card ${team.active ? '' : 'team-inactive'}`}>
      <div className="team-card-head">
        <TeamLogo team={team} />
        <input aria-label="Team name" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} />
        <input aria-label="Abbreviation" className="input-short" value={shortName} onChange={(event) => setShortName(event.target.value)} maxLength={6} />
        <button type="button" disabled={busy || !hasChanges || name.trim() === ''} onClick={() => run(() => api.updateTeam(team.id, { name, shortName }))}>
          Save
        </button>
        <button type="button" className="button-secondary" disabled={busy} onClick={() => run(() => api.updateTeam(team.id, { active: !team.active }))}>
          {team.active ? 'Deactivate' : 'Activate'}
        </button>
        <button
          type="button"
          className="button-danger"
          disabled={busy || team.hasHistory}
          title={team.hasHistory ? 'This team has match history. Deactivate it instead.' : 'Delete team and its players'}
          onClick={() => window.confirm(`Delete team "${team.name}" and its players?`) && run(() => api.deleteTeam(team.id))}
        >
          Delete
        </button>
      </div>
      {team.hasHistory && (
        <p className="muted">
          Delete is unavailable: this team has recorded match results or finishes, which are kept as history. Use Deactivate to remove it from standings and new matches.
        </p>
      )}
      <div className="team-card-logo">
        <label>
          Logo (PNG, JPEG or WebP, max 2 MB)
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files[0];
              if (file) run(() => api.uploadTeamLogo(team.id, file));
              event.target.value = '';
            }}
          />
        </label>
        {team.logoPath && (
          <button type="button" className="button-secondary" disabled={busy} onClick={() => run(() => api.updateTeam(team.id, { logoPath: null }))}>
            Remove logo
          </button>
        )}
      </div>

      {activePlayerCount < playersPerTeam && team.active && (
        <p className="form-message-warning">
          Incomplete roster: {activePlayerCount} of {playersPerTeam} players. The team can still play.
        </p>
      )}
      <ul className="player-rows">
        {teamPlayers.map((player) => (
          <PlayerRow key={player.id} player={player} teams={allTeams} run={run} busy={busy} />
        ))}
      </ul>
      <form className="form-row" onSubmit={addPlayer}>
        <label>
          New player
          <input value={newPlayerName} onChange={(event) => setNewPlayerName(event.target.value)} maxLength={60} required />
        </label>
        <button type="submit" disabled={busy}>
          Add player
        </button>
      </form>
    </li>
  );
}

function PlayerRow({ player, teams, run, busy }) {
  const [name, setName] = useState(player.name);
  const [inGameName, setInGameName] = useState(player.inGameName ?? '');
  const hasChanges = name !== player.name || inGameName !== (player.inGameName ?? '');

  return (
    <li className={`player-row ${player.active ? '' : 'team-inactive'}`}>
      <input aria-label="Player name" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} />
      <input aria-label="In-game name" placeholder="In-game name" value={inGameName} onChange={(event) => setInGameName(event.target.value)} maxLength={60} />
      <select
        aria-label="Move player to team"
        value={player.teamId}
        disabled={busy}
        onChange={(event) => run(() => api.updatePlayer(player.id, { teamId: Number(event.target.value) }))}
      >
        {teams.map((team) => (
          <option key={team.id} value={team.id}>
            {team.name}
          </option>
        ))}
      </select>
      <button type="button" disabled={busy || !hasChanges || name.trim() === ''} onClick={() => run(() => api.updatePlayer(player.id, { name, inGameName }))}>
        Save
      </button>
      <button type="button" className="button-secondary" disabled={busy} onClick={() => run(() => api.updatePlayer(player.id, { active: !player.active }))}>
        {player.active ? 'Deactivate' : 'Activate'}
      </button>
      <button
        type="button"
        className="button-danger"
        disabled={busy}
        onClick={() => window.confirm(`Delete player "${player.name}"? (Not possible if they have recorded finishes.)`) && run(() => api.deletePlayer(player.id))}
      >
        Delete
      </button>
    </li>
  );
}

export default function RosterManager({ state, run, busy }) {
  return (
    <section className="panel">
      <h2>Teams and players</h2>
      <AddTeamForm run={run} busy={busy} />
      {state.teams.length === 0 ? (
        <EmptyState title="No teams yet">Add the first team above.</EmptyState>
      ) : (
        <ul className="team-list">
          {state.teams.map((team) => (
            <TeamRow key={team.id} team={team} allTeams={state.teams} players={state.players} run={run} busy={busy} playersPerTeam={state.config.roster.playersPerTeam} />
          ))}
        </ul>
      )}
    </section>
  );
}
