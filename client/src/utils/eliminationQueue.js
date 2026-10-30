// Pure helpers for the elimination alert queue (see useEliminationNotices).

// Adds an event to the queue unless it is voided or has been queued before. Never drops an event
// because the queue is long. Returns the same arrays when nothing changed.
export function enqueueElimination(queue, seenIds, event) {
  if (!event || event.id === undefined || event.status === 'voided') return { queue, seenIds };
  if (seenIds.has(event.id)) return { queue, seenIds };
  const nextSeen = new Set(seenIds);
  nextSeen.add(event.id);
  return { queue: [...queue, event], seenIds: nextSeen };
}

// Normal alerts stay on air for `baseMs`. When several are waiting they are shortened (down to
// `minMs`) so a burst clears in reasonable time without discarding anything.
export function noticeDuration(waiting, { baseMs = 6000, minMs = 3500 } = {}) {
  if (waiting <= 2) return baseMs;
  return Math.max(minMs, baseMs - (waiting - 2) * 500);
}
