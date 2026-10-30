// All HTTP requests to the backend live here. Components never call fetch directly.
const SECRET_STORAGE_KEY = 'bgmiAdminSecret';

let adminSecret = readStoredSecret();

function readStoredSecret() {
  try {
    return sessionStorage.getItem(SECRET_STORAGE_KEY) ?? '';
  } catch {
    return ''; // storage blocked: the secret then lives only in memory
  }
}

export function getAdminSecret() {
  return adminSecret;
}

export function setAdminSecret(secret) {
  adminSecret = secret;
  try {
    if (secret) sessionStorage.setItem(SECRET_STORAGE_KEY, secret);
    else sessionStorage.removeItem(SECRET_STORAGE_KEY);
  } catch {
    // Ignored on purpose: see readStoredSecret.
  }
}

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

async function request(method, path, { body, rawBody, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  if (adminSecret) requestHeaders['x-admin-secret'] = adminSecret;
  let payload = rawBody;
  if (body !== undefined) {
    requestHeaders['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`/api${path}`, { method, headers: requestHeaders, body: payload });
  } catch {
    throw new ApiError('Cannot reach the server. Check that it is running and try again.', 0, null);
  }
  if (response.status === 204) return null;

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(data?.error?.message ?? `Request failed (${response.status})`, response.status, data?.error?.details ?? null);
  }
  return data;
}

export const api = {
  health: () => request('GET', '/health'),
  verifySecret: () => request('POST', '/auth/verify', { body: {} }),
  getState: () => request('GET', '/state'),
  getAuditLog: (limit = 50) => request('GET', `/audit-log?limit=${limit}`),

  updateEvent: (event) => request('PATCH', '/event', { body: event }),
  // Removes all matches, scores, finishes and eliminations; keeps teams, players and settings.
  resetScores: () => request('POST', '/event/reset-scores', { body: { confirm: 'RESET' } }),
  updateConfig: (config) => request('PUT', '/event/config', { body: config }),

  createTeam: (team) => request('POST', '/teams', { body: team }),
  updateTeam: (teamId, changes) => request('PATCH', `/teams/${teamId}`, { body: changes }),
  deleteTeam: (teamId) => request('DELETE', `/teams/${teamId}`),
  uploadTeamLogo: (teamId, file) =>
    request('PUT', `/teams/${teamId}/logo`, { rawBody: file, headers: { 'content-type': file.type } }),

  createPlayer: (player) => request('POST', '/players', { body: player }),
  updatePlayer: (playerId, changes) => request('PATCH', `/players/${playerId}`, { body: changes }),
  deletePlayer: (playerId) => request('DELETE', `/players/${playerId}`),

  createMatch: (match) => request('POST', '/matches', { body: match }),
  startMatch: (matchId) => request('POST', `/matches/${matchId}/start`, { body: {} }),
  finalizeMatch: (matchId) => request('POST', `/matches/${matchId}/finalize`, { body: {} }),
  reopenMatch: (matchId, reason) => request('POST', `/matches/${matchId}/reopen`, { body: { reason } }),
  setPlacement: (matchId, teamId, placement) =>
    request('PUT', `/matches/${matchId}/results/${teamId}`, { body: { placement } }),
  clearPlacement: (matchId, teamId) => request('DELETE', `/matches/${matchId}/results/${teamId}`),
  // Team finish total (Match Scoring). delta is +1 or -1; requestId must be new for every click.
  adjustTeamFinish: (matchId, teamId, delta, requestId) =>
    request('POST', `/matches/${matchId}/teams/${teamId}/finishes`, { body: { delta, requestId } }),
  // Player Finish Audit. The server never changes the team total because of these.
  getPlayerAudit: (matchId) => request('GET', `/matches/${matchId}/player-audit`),
  adjustPlayerFinish: (matchId, playerId, teamId, delta, requestId) =>
    request('POST', `/matches/${matchId}/players/${playerId}/finishes`, { body: { delta, requestId, teamId } }),

  // Elimination events: credit only, they never change scores. requestId must be new per recording.
  listEliminations: (matchId) => request('GET', `/matches/${matchId}/eliminations`),
  recordElimination: (matchId, body) => request('POST', `/matches/${matchId}/eliminations`, { body }),
  voidElimination: (matchId, eliminationId, reason) =>
    request('POST', `/matches/${matchId}/eliminations/${eliminationId}/void`, { body: { reason } }),

  updateBroadcast: (changes) => request('PUT', '/broadcast', { body: changes }),
  selectMvp: (playerId) => request('PUT', '/mvp', { body: { playerId } }),

  exportBackup: () => request('GET', '/backups/export'),
  importBackup: (backup) => request('POST', '/backups/import', { body: { confirm: true, backup } }),
};
