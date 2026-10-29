import { useCallback, useState } from 'react';

// Runs one admin action at a time and remembers the last error so it can be shown clearly.
// While an action is running `busy` is true, which the buttons use to block double clicks.
export function useActionRunner({ onSuccess } = {}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const run = useCallback(
    async (action) => {
      setBusy(true);
      setError(null);
      try {
        const result = await action();
        if (onSuccess) await onSuccess();
        return { ok: true, result };
      } catch (caughtError) {
        setError(caughtError);
        return { ok: false, error: caughtError };
      } finally {
        setBusy(false);
      }
    },
    [onSuccess],
  );

  const clearError = useCallback(() => setError(null), []);
  return { run, busy, error, clearError };
}
