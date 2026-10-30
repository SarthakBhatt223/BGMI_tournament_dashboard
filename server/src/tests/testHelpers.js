// Shared helpers for tests: a fresh in-memory database with a few teams and players.
import { openDatabase } from '../db/database.js';
import { migrate } from '../db/migrate.js';
import { getActiveEvent, getTournamentConfig, updateTournamentConfig } from '../services/eventService.js';
import { adjustPlayerFinishes } from '../services/playerAuditService.js';
import { createPlayer, createTeam } from '../services/rosterService.js';
import { adjustTeamFinishes, createMatch, setPlacement, startMatch } from '../services/scoringService.js';

// requireReconciliation is off by default so tests about team scoring do not need to enter
// player finishes too. Audit tests switch it on to test the production default behavior.
export function createTestTournament({ teamCount = 4, playersPerTeam = 2, requireReconciliation = false } = {}) {
  const db = openDatabase(':memory:');
  migrate(db);
  const event = getActiveEvent(db);

  const teams = [];
  const playersByTeamId = new Map();
  for (let teamNumber = 1; teamNumber <= teamCount; teamNumber += 1) {
    const team = createTeam(db, event.id, { name: `Team ${teamNumber}`, shortName: `T${teamNumber}` });
    teams.push(team);
    const players = [];
    for (let playerNumber = 1; playerNumber <= playersPerTeam; playerNumber += 1) {
      players.push(createPlayer(db, { teamId: team.id, name: `Player ${teamNumber}-${playerNumber}` }));
    }
    playersByTeamId.set(team.id, players);
  }
  changeScoring(db, event.id, { requirePlayerReconciliationToFinalize: requireReconciliation });
  return { db, eventId: event.id, teams, playersByTeamId };
}

export function changeScoring(db, eventId, scoringChanges) {
  const config = getTournamentConfig(db, eventId);
  return updateTournamentConfig(db, eventId, { ...config, scoring: { ...config.scoring, ...scoringChanges } });
}

export function changeDisplay(db, eventId, displayChanges) {
  const config = getTournamentConfig(db, eventId);
  return updateTournamentConfig(db, eventId, { ...config, display: { ...config.display, ...displayChanges } });
}

export function startNewMatch(db, eventId) {
  const match = createMatch(db, eventId, {});
  return startMatch(db, match.id);
}

// Places teams in the order given: the first team gets placement 1, and so on.
export function placeTeamsInOrder(db, matchId, teams) {
  teams.forEach((team, index) => setPlacement(db, matchId, team.id, { placement: index + 1 }));
}

let requestCounter = 0;
export const nextRequestId = () => `test-request-${(requestCounter += 1)}`;

// Each call is a separate deliberate click with its own request id.
export function addTeamFinishes(db, matchId, teamId, count = 1) {
  for (let click = 0; click < count; click += 1) {
    adjustTeamFinishes(db, matchId, teamId, { delta: 1, requestId: nextRequestId() });
  }
}

export function adjustPlayer(db, matchId, playerId, delta = 1, extra = {}) {
  return adjustPlayerFinishes(db, matchId, playerId, { delta, requestId: nextRequestId(), ...extra });
}
