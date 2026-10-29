import { io } from 'socket.io-client';

// Socket.IO event names; they must match server/src/app.js.
export const SOCKET_EVENTS = { stateUpdate: 'state:update', stateRequest: 'state:request' };

let sharedSocket = null;

// One connection per browser tab, created on first use. It connects to the same origin the
// page was loaded from, so it works on localhost and on the host's LAN address alike.
export function getSocket() {
  if (sharedSocket === null) {
    sharedSocket = io({ reconnection: true, reconnectionDelayMax: 5000 });
  }
  return sharedSocket;
}
