import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { badRequest } from '../errors.js';
import { exportBackup } from '../services/backupService.js';
import { resetScoringData } from '../services/resetService.js';
import { getActiveEvent, getTournamentConfig, updateEvent, updateTournamentConfig } from '../services/eventService.js';

export function createEventRouter({ db, commit, config, scheduler }) {
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

  // Test reset: removes all matches, scores, finishes, eliminations and the MVP/current-match
  // selection, but keeps teams, players, logos and settings. A full JSON backup of everything is
  // written next to the database first, so a mistaken reset can be undone with Backup > Restore.
  // Body: { "confirm": "RESET" }
  router.post('/reset-scores', (req, res) => {
    if (req.body?.confirm !== 'RESET') {
      throw badRequest('Resetting removes all match data. Send "confirm": "RESET" to proceed.');
    }
    const event = getActiveEvent(db);
    // Safety copy of everything, written before anything changes. (Skipped only for an in-memory
    // database, which has no data folder.)
    let backupPath = null;
    if (config.databasePath && config.databasePath !== ':memory:') {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupDirectory = path.join(path.dirname(config.databasePath), 'backups');
      backupPath = path.join(backupDirectory, `before-reset-${stamp}.json`);
      fs.mkdirSync(backupDirectory, { recursive: true });
      fs.writeFileSync(backupPath, JSON.stringify(exportBackup(db), null, 2));
    }

    const removed = commit(() => {
      const result = resetScoringData(db, event.id);
      scheduler?.cancelPresentation('scores_reset');
      return result;
    });
    res.json({ removed, backupFile: backupPath ? path.relative(config.repositoryRoot ?? process.cwd(), backupPath) : null });
  });

  return router;
}
