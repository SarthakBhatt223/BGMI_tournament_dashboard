import express from 'express';
import { badRequest } from '../errors.js';
import { exportBackup, restoreBackup } from '../services/backupService.js';

export function createBackupsRouter({ db, commit, scheduler }) {
  const router = express.Router();

  router.get('/export', (req, res) => {
    const backup = exportBackup(db);
    const stamp = backup.exportedAt.replace(/[:.]/g, '-');
    res.set('Content-Disposition', `attachment; filename="bgmi-backup-${stamp}.json"`);
    res.json(backup);
  });

  // Replaces ALL tournament data. Body: { "confirm": true, "backup": { ...exported file... } }
  router.post('/import', (req, res) => {
    if (req.body?.confirm !== true) {
      throw badRequest('Restoring replaces all tournament data. Send "confirm": true to proceed.');
    }
    res.json(commit(() => {
      const result = restoreBackup(db, req.body.backup);
      scheduler?.cancelPresentation('backup_restored');
      return result;
    }));
  });

  return router;
}
