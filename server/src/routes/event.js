import express from 'express';
import { getActiveEvent, getTournamentConfig, updateEvent, updateTournamentConfig } from '../services/eventService.js';

export function createEventRouter({ db, commit }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json({ event: getActiveEvent(db) });
  });

  router.patch('/', (req, res) => {
    res.json({ event: commit(() => updateEvent(db, req.body)) });
  });

  router.get('/config', (req, res) => {
    res.json({ config: getTournamentConfig(db, getActiveEvent(db).id) });
  });

  // Replaces the whole configuration object after validating it.
  router.put('/config', (req, res) => {
    res.json({ config: commit(() => updateTournamentConfig(db, getActiveEvent(db).id, req.body)) });
  });

  return router;
}
