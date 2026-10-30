import { useEffect, useState } from 'react';

// Milliseconds left until `targetIso`, measured against the server's clock so a wrong clock on
// this device does not matter. `generatedAt` is the server time of the snapshot that carried the
// target; the time elapsed since that snapshot arrived is subtracted locally.
// Returns null when there is no target.
export function useServerCountdown(targetIso, generatedAt) {
  const [now, setNow] = useState(() => performance.now());
  const [anchor, setAnchor] = useState(() => performance.now());

  useEffect(() => {
    setAnchor(performance.now());
    setNow(performance.now());
  }, [generatedAt, targetIso]);

  useEffect(() => {
    if (!targetIso) return undefined;
    const timer = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(timer);
  }, [targetIso]);

  if (!targetIso || !generatedAt) return null;
  const remaining = new Date(targetIso).getTime() - new Date(generatedAt).getTime() - (now - anchor);
  return Math.max(0, remaining);
}

export function formatCountdown(ms) {
  if (ms === null || ms === undefined) return '--:--';
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
