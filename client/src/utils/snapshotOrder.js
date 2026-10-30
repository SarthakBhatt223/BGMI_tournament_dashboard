// The server stamps every state snapshot with `generatedAt`. Snapshots can arrive out of order
// (for example the page-load REST fetch finishing after a newer socket push), so an older snapshot
// must never replace a newer one. Pure function: the hook decides when to use it.
export function pickNewerSnapshot(current, incoming) {
  if (!incoming) return current;
  if (!current) return incoming;
  const currentTime = Date.parse(current.generatedAt);
  const incomingTime = Date.parse(incoming.generatedAt);
  if (Number.isNaN(currentTime) || Number.isNaN(incomingTime)) return incoming;
  return incomingTime >= currentTime ? incoming : current;
}
