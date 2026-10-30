import express from 'express';
import { getActiveEvent, getTournamentConfig } from '../services/eventService.js';
import { computePlayerStats } from '../services/playerStatsService.js';
import { computeStandings, splitIntoPages } from '../services/standingsService.js';

export function createStandingsRouter({ db }) {
  const router = express.Router();

  router.get('/standings', (req, res) => {
    const event = getActiveEvent(db);
    const standings = computeStandings(db, event.id);
    const pageSize = getTournamentConfig(db, event.id).display.teamsPerPage;
    res.json({ standings, pages: splitIntoPages(standings, pageSize) });
  });

  router.get('/player-stats', (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search : '';
    res.json({ playerStats: computePlayerStats(db, getActiveEvent(db).id, { search }) });
  });

  return router;
}
