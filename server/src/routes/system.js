import express from 'express';
import { listAuditEntries } from '../services/auditService.js';

const startedAt = new Date();

export function createSystemRouter({ db, config, getState }) {
  const router = express.Router();

  router.get('/health', (req, res) => {
    db.prepare('SELECT 1').get();
    res.json({
      status: 'ok',
      startedAt: startedAt.toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      authRequired: config.adminSecret !== '',
    });
  });

  // Full authoritative snapshot; the same payload Socket.IO pushes as "state:update".
  router.get('/state', (req, res) => {
    res.json(getState());
  });

  // Sits behind the admin-secret check for POST, so success means the secret is correct.
  router.post('/auth/verify', (req, res) => {
    res.json({ ok: true });
  });

  router.get('/audit-log', (req, res) => {
    res.json({ entries: listAuditEntries(db, { limit: req.query.limit }) });
  });

  return router;
}
