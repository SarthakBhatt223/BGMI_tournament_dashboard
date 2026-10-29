// Demo data: clearly fictional placeholder teams and players, so the UI has something to show.
// It only runs on a database without teams. Replace it with the real roster in /admin.
import { fileURLToPath } from 'node:url';
import { loadServerConfig } from '../config.js';
import { getActiveEvent } from '../services/eventService.js';
import { createPlayer, createTeam, listTeams } from '../services/rosterService.js';
import { openDatabase } from './database.js';
import { migrate } from './migrate.js';

// TODO: CONFIGURE HERE - the real tournament has 18 teams; adjust only for demo purposes.
const DEMO_TEAM_COUNT = 18;
const DEMO_PLAYERS_PER_TEAM = 4;

export function seedDemoData(db) {
  const event = getActiveEvent(db);
  if (listTeams(db, event.id).length > 0) return { seeded: false };

  for (let teamNumber = 1; teamNumber <= DEMO_TEAM_COUNT; teamNumber += 1) {
    const label = String(teamNumber).padStart(2, '0');
    const team = createTeam(db, event.id, { name: `Placeholder Team ${label}`, shortName: `T${label}` });
    for (let playerNumber = 1; playerNumber <= DEMO_PLAYERS_PER_TEAM; playerNumber += 1) {
      createPlayer(db, { teamId: team.id, name: `Player ${label}-${playerNumber}` });
    }
  }
  return { seeded: true, teams: DEMO_TEAM_COUNT, players: DEMO_TEAM_COUNT * DEMO_PLAYERS_PER_TEAM };
}

// `npm run db:seed`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = loadServerConfig();
  const db = openDatabase(config.databasePath);
  migrate(db);
  const result = seedDemoData(db);
  console.log(result.seeded ? `Seeded ${result.teams} teams and ${result.players} players.` : 'Teams already exist; nothing seeded.');
  db.close();
}
