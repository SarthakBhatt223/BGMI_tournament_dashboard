// Assembles the HTTP API, static media, Socket.IO and the state publisher.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { Server as SocketServer } from 'socket.io';
import { AppError, unauthorized } from './errors.js';
import { createStatePublisher } from './services/broadcastService.js';
import { buildState } from './services/stateService.js';
import { createBackupsRouter } from './routes/backups.js';
import { createBroadcastRouter } from './routes/broadcast.js';
import { createEventRouter } from './routes/event.js';
import { createMatchesRouter } from './routes/matches.js';
import { createMvpRouter } from './routes/mvp.js';
import { createPlayersRouter } from './routes/players.js';
import { createStandingsRouter } from './routes/standings.js';
import { createSystemRouter } from './routes/system.js';
import { createTeamsRouter } from './routes/teams.js';

// Socket.IO event names (server -> client unless noted):
//   state:update   payload: full state snapshot from buildState()
//   state:request  (client -> server) optional ack callback receives the snapshot
export const SOCKET_EVENTS = { stateUpdate: 'state:update', stateRequest: 'state:request' };

// Reads are public so /display works without a secret. Everything that changes data, and the
// private read-only endpoints below, require the admin secret when one is configured.
const PRIVATE_READ_PREFIXES = ['/backups', '/audit-log'];
// The Player Finish Audit is admin-only, so its per-player data is not readable without the secret.
const PRIVATE_READ_PATTERNS = [/^\/matches\/\d+\/(player-audit|finish-events)\/?$/];

function createAdminSecretGuard(adminSecret) {
  const digestOf = (text) => crypto.createHash('sha256').update(text).digest();
  const expectedDigest = digestOf(adminSecret);

  return (req, res, next) => {
    const isRead = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const isPrivateRead = PRIVATE_READ_PREFIXES.some((prefix) => req.path.startsWith(prefix))
      || PRIVATE_READ_PATTERNS.some((pattern) => pattern.test(req.path));
    if (adminSecret === '' || (isRead && !isPrivateRead)) return next();

    const provided = req.get('x-admin-secret') ?? '';
    if (!crypto.timingSafeEqual(digestOf(provided), expectedDigest)) {
      return next(unauthorized('Missing or incorrect admin secret'));
    }
    return next();
  };
}

function handleErrors(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error instanceof AppError) {
    return res.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details } });
  }
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'bad_request', message: 'Request body is not valid JSON', details: null } });
  }
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'too_large', message: 'Request body is too large', details: null } });
  }
  console.error('Unexpected error:', error);
  return res.status(500).json({ error: { code: 'internal_error', message: 'Unexpected server error', details: null } });
}

export function createApp({ db, config }) {
  const app = express();
  const server = http.createServer(app);
  const io = new SocketServer(server);

  const getState = () => buildState(db, { mediaDirectory: config.mediaDirectory });
  const publisher = createStatePublisher({
    buildState: getState,
    emitState: (state) => io.emit(SOCKET_EVENTS.stateUpdate, state),
  });
  const context = { db, config, commit: publisher.commit, getState };

  // New and reconnecting clients always receive the current state immediately.
  io.on('connection', (socket) => {
    try {
      socket.emit(SOCKET_EVENTS.stateUpdate, getState());
    } catch (error) {
      console.error('Failed to send initial state:', error);
    }
    socket.on(SOCKET_EVENTS.stateRequest, (acknowledge) => {
      if (typeof acknowledge === 'function') acknowledge(getState());
    });
  });

  app.disable('x-powered-by');
  app.use('/api', express.json({ limit: '10mb' }));
  app.use('/api', createAdminSecretGuard(config.adminSecret));
  app.use('/api', createSystemRouter(context));
  app.use('/api', createStandingsRouter(context));
  app.use('/api/event', createEventRouter(context));
  app.use('/api/teams', createTeamsRouter(context));
  app.use('/api/players', createPlayersRouter(context));
  app.use('/api/matches', createMatchesRouter(context));
  app.use('/api/broadcast', createBroadcastRouter(context));
  app.use('/api/mvp', createMvpRouter(context));
  app.use('/api/backups', createBackupsRouter(context));
  app.use('/api', (req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: `No API route for ${req.method} ${req.originalUrl}`, details: null } });
  });

  app.use('/media', express.static(config.mediaDirectory));

  // Serve the built React app (npm run build) so one process can run the whole event.
  const indexHtmlPath = path.join(config.clientDistDirectory, 'index.html');
  if (fs.existsSync(indexHtmlPath)) {
    app.use(express.static(config.clientDistDirectory));
    app.get(/^\/(?!api\/|socket\.io\/|media\/).*/, (req, res) => res.sendFile(indexHtmlPath));
  }

  app.use(handleErrors);
  return { app, server, io, publisher };
}
