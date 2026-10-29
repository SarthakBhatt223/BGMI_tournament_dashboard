import express from 'express';
import { createPlayer, deletePlayer, getPlayer, listPlayers, updatePlayer } from '../services/rosterService.js';
import { getActiveEvent } from '../services/eventService.js';
import { parseId } from '../validation.js';

export function createPlayersRouter({ db, commit }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const teamId = req.query.teamId === undefined ? null : parseId(req.query.teamId, 'teamId');
    res.json({ players: listPlayers(db, getActiveEvent(db).id, { teamId }) });
  });

  router.post('/', (req, res) => {
    const player = commit(() => createPlayer(db, req.body));
    res.status(201).json({ player });
  });

  router.get('/:id', (req, res) => {
    res.json({ player: getPlayer(db, parseId(req.params.id)) });
  });

  router.patch('/:id', (req, res) => {
    const player = commit(() => updatePlayer(db, parseId(req.params.id), req.body));
    res.json({ player });
  });

  router.delete('/:id', (req, res) => {
    commit(() => deletePlayer(db, parseId(req.params.id)));
    res.status(204).end();
  });

  return router;
}
