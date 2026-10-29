import { useCallback, useEffect, useRef, useState } from 'react';

const SAVED_FLASH_MS = 1800;

// Runs admin actions that belong to one row (a team or a player) and tracks each row's status.
//
// Unlike useActionRunner this does NOT lock the whole page while a request runs: a scorer who
// clicks "+" three times quickly means three finishes, so every click is sent (each with its own
// request id, created by the caller). Duplicate protection against retried requests is done by the
// server through that request id.
//
// Status per key: { pending, state: 'saving' | 'saved' | 'error', message }.
// 'saved' is only ever set after the server confirmed the change.
export function useKeyedActions({ onSuccess } = {}) {
  const [statuses, setStatuses] = useState({});
  const [lastError, setLastError] = useState(null);
  const onSuccessRef = useRef(onSuccess);
  const flashTimers = useRef(new Map());

  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  useEffect(() => {
    const timers = flashTimers.current;
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, []);

  const update = useCallback((key, change) => {
    setStatuses((current) => {
      const previous = current[key] ?? { pending: 0, state: null, message: '' };
      return { ...current, [key]: { ...previous, ...change(previous) } };
    });
  }, []);

  const runFor = useCallback(
    async (key, action) => {
      clearTimeout(flashTimers.current.get(key));
      update(key, (previous) => ({ pending: previous.pending + 1, state: 'saving', message: '' }));
      setLastError(null);
      try {
        const result = await action();
        if (onSuccessRef.current) await onSuccessRef.current();
        update(key, (previous) => {
          const pending = previous.pending - 1;
          return { pending, state: pending > 0 ? 'saving' : 'saved', message: '' };
        });
        flashTimers.current.set(
          key,
          setTimeout(() => {
            update(key, (previous) => (previous.pending === 0 && previous.state === 'saved' ? { state: null } : {}));
          }, SAVED_FLASH_MS),
        );
        return { ok: true, result };
      } catch (error) {
        update(key, (previous) => ({ pending: previous.pending - 1, state: 'error', message: error.message }));
        setLastError(error);
        return { ok: false, error };
      }
    },
    [update],
  );

  const clearError = useCallback(() => setLastError(null), []);
  return { runFor, statuses, lastError, clearError };
}

export function statusText(status) {
  if (!status?.state) return '';
  if (status.state === 'saving') return 'Saving...';
  if (status.state === 'saved') return 'Saved';
  return status.message || 'Not saved';
}
