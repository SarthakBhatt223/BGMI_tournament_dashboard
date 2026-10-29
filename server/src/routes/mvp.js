import express from 'express';
import { getBroadcastState, selectMvp } from '../services/broadcastService.js';
import { getActiveEvent } from '../services/eventService.js';
import { computePlayerStats } from '../services/playerStatsService.js';
import { badRequest } from '../errors.js';

export function createMvpRouter({ db, commit }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const { mvpPlayerId } = getBroadcastState(db);
    const mvp = mvpPlayerId === null
      ? null
      : computePlayerStats(db, getActiveEvent(db).id).find((entry) => entry.playerId === mvpPlayerId) ?? null;
    res.json({ mvp });
  });

  // Body: { "playerId": 12 } selects the MVP, { "playerId": null } clears it.
  router.put('/', (req, res) => {
    if (req.body === null || typeof req.body !== 'object' || !('playerId' in req.body)) {
      throw badRequest('playerId is required (use null to clear the MVP)');
    }
    const broadcast = commit(() => selectMvp(db, getActiveEvent(db).id, req.body.playerId));
    res.json({ broadcast });
  });

  return router;
}
