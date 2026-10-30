// Builds the complete authoritative snapshot that is sent to /admin and /display.
// The frontend only renders this; it never calculates scores itself.
import fs from 'node:fs';
import path from 'node:path';
import { getBroadcastState } from './broadcastService.js';
import { getActiveEvent, getTournamentConfig } from './eventService.js';
import { computePlayerStats } from './playerStatsService.js';
import { listPlayers, listTeams } from './rosterService.js';
import { getMatchDetail, listMatches } from './scoringService.js';
import { computeStandings, pageIndexForAppearance, splitIntoPages } from './standingsService.js';

// `presentation` / `scheduleStatus` come from the leaderboard scheduler (null when there is none).
export function buildState(db, { mediaDirectory, getPresentation = () => null, getScheduleStatus = () => null }) {
  const event = getActiveEvent(db);
  const config = getTournamentConfig(db, event.id);
  const broadcast = getBroadcastState(db);

  const teams = listTeams(db, event.id);
  const players = listPlayers(db, event.id);
  const standings = computeStandings(db, event.id);
  const playerStats = computePlayerStats(db, event.id);

  const currentMatch = broadcast.currentMatchId === null ? null : getMatchDetail(db, broadcast.currentMatchId);
  const mvpStats = broadcast.mvpPlayerId === null
    ? null
    : playerStats.find((entry) => entry.playerId === broadcast.mvpPlayerId) ?? null;

  const ambientVideoFile = config.display.ambientVideoFile;
  const standingsPages = splitIntoPages(standings, config.display.teamsPerPage);
  return {
    generatedAt: new Date().toISOString(),
    event,
    config,
    counts: {
      teams: teams.filter((team) => team.active).length,
      players: players.filter((player) => player.active).length,
    },
    teams,
    players,
    matches: listMatches(db, event.id),
    currentMatch,
    standings,
    standingsPages,
    // Everything the compact leaderboard needs, derived from the real team count.
    leaderboard: {
      teamCount: standings.length,
      teamsPerPage: config.display.teamsPerPage,
      pageCount: standingsPages.length,
      currentPageIndex: pageIndexForAppearance(broadcast.leaderboardAppearance, standingsPages.length),
      rotatePagesWhileVisible: config.display.rotatePagesWhileVisible,
    },
    playerStats,
    topFraggers: playerStats.slice(0, config.display.topFraggersCount),
    broadcast: {
      ...broadcast,
      // A scheduled leaderboard currently overlaying the ambient display (null when none). The
      // display shows it until `endsAt`; compare with `generatedAt` to avoid clock differences.
      presentation: getPresentation(),
      schedule: {
        ...config.scheduledLeaderboard,
        nextRunAt: getScheduleStatus()?.nextRunAt ?? null,
      },
    },
    mvp: mvpStats,
    media: {
      ambientVideoUrl: `/media/${ambientVideoFile}`,
      ambientVideoAvailable: fs.existsSync(path.join(mediaDirectory, ambientVideoFile)),
    },
  };
}
