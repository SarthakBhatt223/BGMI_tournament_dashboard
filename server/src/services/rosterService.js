// Teams and players: create, edit, list, delete (only when no match history exists).
import { runInTransaction, toFlag } from '../db/database.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { recordAudit } from './auditService.js';
import { optionalMediaPath, optionalText, requireBoolean, requireObject, requireText } from '../validation.js';

const teamHasHistorySql = `
  (EXISTS (SELECT 1 FROM team_match_results WHERE team_id = teams.id)
   OR EXISTS (SELECT 1 FROM finish_events WHERE team_id = teams.id)) AS has_history`;

function toTeamDto(row) {
  return {
    id: row.id,
    eventId: row.event_id,
    name: row.name,
    shortName: row.short_name,
    logoPath: row.logo_path,
    active: row.active === 1,
    playerCount: row.player_count,
    hasHistory: row.has_history === 1,
  };
}

function toPlayerDto(row) {
  return {
    id: row.id,
    teamId: row.team_id,
    teamName: row.team_name,
    name: row.name,
    inGameName: row.in_game_name,
    active: row.active === 1,
  };
}

export function listTeams(db, eventId) {
  return db
    .prepare(
      `SELECT teams.*, ${teamHasHistorySql},
              (SELECT COUNT(*) FROM players WHERE team_id = teams.id AND active = 1) AS player_count
       FROM teams WHERE event_id = ? ORDER BY name COLLATE NOCASE, id`,
    )
    .all(eventId)
    .map(toTeamDto);
}

export function getTeam(db, teamId) {
  const row = db
    .prepare(
      `SELECT teams.*, ${teamHasHistorySql},
              (SELECT COUNT(*) FROM players WHERE team_id = teams.id AND active = 1) AS player_count
       FROM teams WHERE id = ?`,
    )
    .get(teamId);
  if (!row) throw notFound(`Team ${teamId} does not exist`);
  return toTeamDto(row);
}

function assertTeamNameAvailable(db, eventId, name, exceptTeamId = null) {
  const clash = db
    .prepare('SELECT id FROM teams WHERE event_id = ? AND name = ? COLLATE NOCASE AND id IS NOT ?')
    .get(eventId, name, exceptTeamId);
  if (clash) throw conflict(`A team named "${name}" already exists`);
}

export function createTeam(db, eventId, input) {
  const body = requireObject(input);
  const name = requireText(body.name, 'name', { max: 60 });
  const shortName = optionalText(body.shortName, 'shortName', { max: 6 });
  const logoPath = optionalMediaPath(body.logoPath, 'logoPath');
  return runInTransaction(db, () => {
    assertTeamNameAvailable(db, eventId, name);
    const { lastInsertRowid } = db
      .prepare('INSERT INTO teams (event_id, name, short_name, logo_path) VALUES (?, ?, ?, ?)')
      .run(eventId, name, shortName, logoPath);
    const teamId = Number(lastInsertRowid);
    recordAudit(db, eventId, 'team.create', 'team', teamId, { name, shortName });
    return getTeam(db, teamId);
  });
}

export function updateTeam(db, teamId, input) {
  const body = requireObject(input);
  const current = getTeam(db, teamId);
  const name = body.name === undefined ? current.name : requireText(body.name, 'name', { max: 60 });
  const shortName = body.shortName === undefined ? current.shortName : optionalText(body.shortName, 'shortName', { max: 6 });
  const logoPath = body.logoPath === undefined ? current.logoPath : optionalMediaPath(body.logoPath, 'logoPath');
  const active = body.active === undefined ? current.active : requireBoolean(body.active, 'active');
  return runInTransaction(db, () => {
    assertTeamNameAvailable(db, current.eventId, name, teamId);
    db.prepare('UPDATE teams SET name = ?, short_name = ?, logo_path = ?, active = ? WHERE id = ?')
      .run(name, shortName, logoPath, toFlag(active), teamId);
    recordAudit(db, current.eventId, 'team.update', 'team', teamId, {
      before: { name: current.name, shortName: current.shortName, active: current.active },
      after: { name, shortName, active },
    });
    return getTeam(db, teamId);
  });
}

export function setTeamLogoPath(db, teamId, logoPath) {
  return updateTeam(db, teamId, { logoPath });
}

export function deleteTeam(db, teamId) {
  const team = getTeam(db, teamId);
  if (team.hasHistory) {
    throw conflict(
      `Team "${team.name}" has recorded match history and cannot be deleted. Set it to inactive instead.`,
    );
  }
  runInTransaction(db, () => {
    db.prepare(
      'UPDATE broadcast_state SET mvp_player_id = NULL WHERE mvp_player_id IN (SELECT id FROM players WHERE team_id = ?)',
    ).run(teamId);
    db.prepare('DELETE FROM players WHERE team_id = ?').run(teamId);
    db.prepare('DELETE FROM teams WHERE id = ?').run(teamId);
    recordAudit(db, team.eventId, 'team.delete', 'team', teamId, { name: team.name });
  });
}

export function listPlayers(db, eventId, { teamId = null } = {}) {
  return db
    .prepare(
      `SELECT players.*, teams.name AS team_name
       FROM players JOIN teams ON teams.id = players.team_id
       WHERE teams.event_id = ? AND (? IS NULL OR players.team_id = ?)
       ORDER BY teams.name COLLATE NOCASE, players.name COLLATE NOCASE, players.id`,
    )
    .all(eventId, teamId, teamId)
    .map(toPlayerDto);
}

export function getPlayer(db, playerId) {
  const row = db
    .prepare('SELECT players.*, teams.name AS team_name FROM players JOIN teams ON teams.id = players.team_id WHERE players.id = ?')
    .get(playerId);
  if (!row) throw notFound(`Player ${playerId} does not exist`);
  return toPlayerDto(row);
}

function requireExistingTeamId(db, value) {
  if (!Number.isInteger(value)) throw badRequest('teamId must be a whole number');
  return getTeam(db, value);
}

export function createPlayer(db, input) {
  const body = requireObject(input);
  const team = requireExistingTeamId(db, body.teamId);
  const name = requireText(body.name, 'name', { max: 60 });
  const inGameName = optionalText(body.inGameName, 'inGameName', { max: 60 });
  return runInTransaction(db, () => {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO players (team_id, name, in_game_name) VALUES (?, ?, ?)')
      .run(team.id, name, inGameName);
    const playerId = Number(lastInsertRowid);
    recordAudit(db, team.eventId, 'player.create', 'player', playerId, { name, teamId: team.id });
    return getPlayer(db, playerId);
  });
}

export function updatePlayer(db, playerId, input) {
  const body = requireObject(input);
  const current = getPlayer(db, playerId);
  const team = body.teamId === undefined ? getTeam(db, current.teamId) : requireExistingTeamId(db, body.teamId);
  const name = body.name === undefined ? current.name : requireText(body.name, 'name', { max: 60 });
  const inGameName = body.inGameName === undefined ? current.inGameName : optionalText(body.inGameName, 'inGameName', { max: 60 });
  const active = body.active === undefined ? current.active : requireBoolean(body.active, 'active');
  return runInTransaction(db, () => {
    db.prepare('UPDATE players SET team_id = ?, name = ?, in_game_name = ?, active = ? WHERE id = ?')
      .run(team.id, name, inGameName, toFlag(active), playerId);
    recordAudit(db, team.eventId, 'player.update', 'player', playerId, {
      before: { name: current.name, teamId: current.teamId, active: current.active },
      after: { name, teamId: team.id, active },
    });
    return getPlayer(db, playerId);
  });
}

export function deletePlayer(db, playerId) {
  const player = getPlayer(db, playerId);
  const team = getTeam(db, player.teamId);
  const hasFinishes = db.prepare('SELECT 1 FROM finish_events WHERE player_id = ? LIMIT 1').get(playerId);
  if (hasFinishes) {
    throw conflict(`Player "${player.name}" has recorded finishes and cannot be deleted. Set the player to inactive instead.`);
  }
  runInTransaction(db, () => {
    db.prepare('UPDATE broadcast_state SET mvp_player_id = NULL WHERE mvp_player_id = ?').run(playerId);
    db.prepare('DELETE FROM players WHERE id = ?').run(playerId);
    recordAudit(db, team.eventId, 'player.delete', 'player', playerId, { name: player.name });
  });
}
