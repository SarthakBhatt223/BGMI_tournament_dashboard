import express from 'express';
import { correctFinishPlayer, undoFinish } from '../services/scoringService.js';
import { parseId } from '../validation.js';

export function createFinishEventsRouter({ db, commit }) {
  const router = express.Router();

  // Undo one specific finish. Repeating the call is harmless (duplicate: true).
  router.post('/:id/undo', (req, res) => {
    res.json(commit(() => undoFinish(db, parseId(req.params.id))));
  });

  // Correct the player credited with a finish (same team only).
  router.patch('/:id', (req, res) => {
    res.json(commit(() => correctFinishPlayer(db, parseId(req.params.id), req.body)));
  });

  return router;
}
