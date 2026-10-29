import express from 'express';
import { getActiveEvent } from '../services/eventService.js';
import { adjustPlayerFinishes, getPlayerAudit } from '../services/playerAuditService.js';
import {
  adjustTeamFinishes,
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

  // Team finish total. Body: { "delta": 1 or -1, "requestId": "<unique per click>" }.
  // A repeated requestId returns the first response with "duplicate": true.
  router.post('/:id/teams/:teamId/finishes', (req, res) => {
    res.json(commit(() => adjustTeamFinishes(db, parseId(req.params.id), parseId(req.params.teamId, 'teamId'), req.body)));
  });

  // Player Finish Audit data of one match: per-team reconciliation and player finishes.
  router.get('/:id/player-audit', (req, res) => {
    res.json(getPlayerAudit(db, parseId(req.params.id)));
  });

  // Individual player finish. Body: { "delta": 1 or -1, "requestId", "teamId" (optional) }.
  // The response includes the refreshed audit so the tab can update immediately.
  router.post('/:id/players/:playerId/finishes', (req, res) => {
    const matchId = parseId(req.params.id);
    const result = commit(() => adjustPlayerFinishes(db, matchId, parseId(req.params.playerId, 'playerId'), req.body));
    res.json({ ...result, audit: getPlayerAudit(db, matchId) });
  });

  return router;
}
