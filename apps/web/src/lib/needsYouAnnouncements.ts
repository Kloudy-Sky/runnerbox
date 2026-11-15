const KEEP = 500;

// Which "Needs you" items to announce: those this device hasn't seen yet. With nothing seen yet,
// every current item counts as seen, so turning notifications on doesn't announce a backlog.
export function toAnnounce(ids: ReadonlyArray<string>, seen: ReadonlyArray<string> | null) {
  if (seen === null) return { announce: [], seen: ids.slice(-KEEP) };
  const known = new Set(seen);
  return { announce: ids.filter((id) => !known.has(id)), seen: [...new Set([...seen, ...ids])].slice(-KEEP) };
}
