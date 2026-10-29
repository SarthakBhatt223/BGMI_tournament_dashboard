// Application (machine-level) configuration, read from environment variables.
// Event-specific settings (scoring, branding, display) live in the database; see
// services/defaultTournamentConfig.js.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function resolveFromRoot(configuredPath, fallbackPath) {
  const chosenPath = configuredPath || fallbackPath;
  return path.isAbsolute(chosenPath) ? chosenPath : path.resolve(repositoryRoot, chosenPath);
}

export function loadServerConfig(env = process.env) {
  return {
    repositoryRoot,
    port: Number(env.PORT ?? 3001),
    host: env.HOST ?? '127.0.0.1',
    adminSecret: env.ADMIN_SECRET ?? '',
    databasePath: resolveFromRoot(env.DATABASE_PATH, 'data/tournament.db'),
    mediaDirectory: resolveFromRoot(env.MEDIA_DIR, 'public/media'),
    clientDistDirectory: resolveFromRoot(env.CLIENT_DIST, 'client/dist'),
    seedDemoData: env.SEED_DEMO_DATA === 'true',
  };
}

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1'];

// Refuse to expose score-changing routes to the network without a secret.
export function assertSafeNetworkConfig(config) {
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error(`PORT must be a number between 1 and 65535 (got "${config.port}")`);
  }
  const isLoopbackOnly = LOOPBACK_HOSTS.includes(config.host);
  if (!isLoopbackOnly && config.adminSecret.length < 8) {
    throw new Error(
      `HOST is "${config.host}" (reachable from the network) but ADMIN_SECRET is missing or shorter than 8 characters. ` +
        'Set ADMIN_SECRET in .env, or set HOST=127.0.0.1.',
    );
  }
}
