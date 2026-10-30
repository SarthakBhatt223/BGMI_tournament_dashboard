import { useEffect, useRef, useState } from 'react';
import { getSocket, SOCKET_EVENTS } from '../services/socket.js';
import { enqueueElimination, noticeDuration } from '../utils/eliminationQueue.js';

// Queues `elimination:new` events from the server and hands them out one at a time, in the order
// they arrived. Every event is shown; a long queue only shortens how long each one stays. This
// never changes any score and never touches the broadcast mode.
// Returns { current, leaving, waiting }: `leaving` is true during the exit animation.
export function useEliminationNotices({ displayMs = 6000, exitMs = 450 } = {}) {
  const [queue, setQueue] = useState([]);
  const [leaving, setLeaving] = useState(false);
  const seenIds = useRef(new Set()); // an event is queued at most once, even if it is re-sent

  useEffect(() => {
    const socket = getSocket();
    const handleNew = (event) => {
      setQueue((current) => {
        const next = enqueueElimination(current, seenIds.current, event);
        seenIds.current = next.seenIds;
        return next.queue;
      });
    };
    socket.on(SOCKET_EVENTS.eliminationNew, handleNew);
    return () => socket.off(SOCKET_EVENTS.eliminationNew, handleNew);
  }, []);

  const currentId = queue[0]?.id;
  // Read through a ref so a newly queued event does not restart the timer of the one on air.
  const waitingRef = useRef(0);
  waitingRef.current = Math.max(0, queue.length - 1);
  useEffect(() => {
    if (currentId === undefined) return undefined;
    setLeaving(false);
    const duration = noticeDuration(waitingRef.current, { baseMs: displayMs });
    const startExit = setTimeout(() => setLeaving(true), Math.max(0, duration - exitMs));
    const finish = setTimeout(() => setQueue((current) => current.slice(1)), duration);
    return () => {
      clearTimeout(startExit);
      clearTimeout(finish);
    };
  }, [currentId, displayMs, exitMs]);

  return { current: queue[0] ?? null, leaving, waiting: Math.max(0, queue.length - 1) };
}
