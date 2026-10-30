import express from 'express';
import { getBroadcastState, updateBroadcastState } from '../services/broadcastService.js';
import { getActiveEvent } from '../services/eventService.js';

export function createBroadcastRouter({ db, commit, scheduler }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json({ broadcast: getBroadcastState(db) });
  });

  router.put('/', (req, res) => {
    // A deliberate mode change by the operator always beats a scheduled presentation: the
    // scheduler cancels it here, inside the same commit, so one snapshot is published.
    const broadcast = commit(() => {
      const updated = updateBroadcastState(db, getActiveEvent(db).id, req.body);
      scheduler?.handleManualBroadcastChange(req.body);
      return updated;
    });
    res.json({ broadcast });
  });

  return router;
}
