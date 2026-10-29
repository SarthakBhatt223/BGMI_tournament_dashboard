import express from 'express';
import { getBroadcastState, updateBroadcastState } from '../services/broadcastService.js';
import { getActiveEvent } from '../services/eventService.js';

export function createBroadcastRouter({ db, commit }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json({ broadcast: getBroadcastState(db) });
  });

  router.put('/', (req, res) => {
    const broadcast = commit(() => updateBroadcastState(db, getActiveEvent(db).id, req.body));
    res.json({ broadcast });
  });

  return router;
}
