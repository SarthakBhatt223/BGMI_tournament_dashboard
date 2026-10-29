import express from 'express';
import { getActiveEvent } from '../services/eventService.js';
import {
  addFinish,
  clearPlacement,
  createMatch,
  finalizeMatch,
  getMatchDetail,
  listFinishEvents,
  listMatches,
  reopenMatch,
  setPlacement,
  startMatch,
} from '../services/scoringService.js';
import { parseId } from '../validation.js';

export function createMatchesRouter({ db, commit }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json({ matches: listMatches(db, getActiveEvent(db).id) });
  });

  router.post('/', (req, res) => {
    const match = commit(() => createMatch(db, getActiveEvent(db).id, req.body ?? {}));
    res.status(201).json({ match });
  });

  router.get('/:id', (req, res) => {
    res.json(getMatchDetail(db, parseId(req.params.id)));
  });

  router.post('/:id/start', (req, res) => {
    const match = commit(() => startMatch(db, parseId(req.params.id)));
    res.json({ match });
  });

  router.post('/:id/finalize', (req, res) => {
    res.json(commit(() => finalizeMatch(db, parseId(req.params.id))));
  });

  router.post('/:id/reopen', (req, res) => {
    res.json(commit(() => reopenMatch(db, parseId(req.params.id), req.body)));
  });

  router.put('/:id/results/:teamId', (req, res) => {
    res.json(commit(() => setPlacement(db, parseId(req.params.id), parseId(req.params.teamId, 'teamId'), req.body)));
  });

  router.delete('/:id/results/:teamId', (req, res) => {
    res.json(commit(() => clearPlacement(db, parseId(req.params.id), parseId(req.params.teamId, 'teamId'))));
  });

  router.get('/:id/finish-events', (req, res) => {
    res.json({ finishEvents: listFinishEvents(db, parseId(req.params.id)) });
  });

  // Responds 201 for a new finish and 200 when the same requestId was already processed.
  router.post('/:id/finish-events', (req, res) => {
    const result = commit(() => addFinish(db, parseId(req.params.id), req.body));
    res.status(result.duplicate ? 200 : 201).json(result);
  });

  return router;
}
