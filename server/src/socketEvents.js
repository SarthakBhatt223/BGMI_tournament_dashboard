// Socket.IO event names shared by the server code. See README "Real-time protocol".
export const SOCKET_EVENTS = {
  // Full state snapshot (existing). Sent on connect, on `state:request`, and after every change.
  stateUpdate: 'state:update',
  stateRequest: 'state:request',
  // A new elimination event was recorded: "Team A eliminated by Team B".
  eliminationNew: 'elimination:new',
  // A scheduled leaderboard presentation started (payload: page of standings and timing).
  broadcastLeaderboard: 'broadcast:leaderboard',
  // The scheduled presentation started, ended (display returns to ambient) or was cancelled.
  broadcastState: 'broadcast:state',
};
