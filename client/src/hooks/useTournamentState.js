import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api.js';
import { getSocket, SOCKET_EVENTS } from '../services/socket.js';

// Keeps the latest authoritative server state. The server pushes a full snapshot after every
// committed change and on every (re)connection; this hook only stores and exposes it.
export function useTournamentState() {
  const [state, setState] = useState(null);
  const [connection, setConnection] = useState('connecting'); // connecting | connected | disconnected

  const refresh = useCallback(async () => {
    try {
      setState(await api.getState());
    } catch {
      // The socket (or the next refresh) will bring fresh state; keep showing what we have.
    }
  }, []);

  useEffect(() => {
    const socket = getSocket();
    const handleConnect = () => {
      setConnection('connected');
      socket.emit(SOCKET_EVENTS.stateRequest, setState);
    };
    const handleDisconnect = () => setConnection('disconnected');

    socket.on(SOCKET_EVENTS.stateUpdate, setState);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleDisconnect);
    if (socket.connected) handleConnect();
    refresh(); // lets the page render even before the socket is up

    return () => {
      socket.off(SOCKET_EVENTS.stateUpdate, setState);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleDisconnect);
    };
  }, [refresh]);

  return { state, connection, refresh };
}
