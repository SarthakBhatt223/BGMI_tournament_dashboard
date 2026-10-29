// Shared helpers for tests: a fresh in-memory database with a few teams and players.
import { openDatabase } from '../db/database.js';
import { migrate } from '../db/migrate.js';
import { getActiveEvent, getTournamentConfig, updateTournamentConfig } from '../services/eventService.js';
import { createPlayer, createTeam } from '../services/rosterService.js';
import { createMatch, setPlacement, startMatch } from '../services/scoringService.js';

export function createTestTournament({ teamCount = 4, playersPerTeam = 2 } = {}) {
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
  return { db, eventId: event.id, teams, playersByTeamId };
}

export function changeScoring(db, eventId, scoringChanges) {
  const config = getTournamentConfig(db, eventId);
  return updateTournamentConfig(db, eventId, { ...config, scoring: { ...config.scoring, ...scoringChanges } });
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
