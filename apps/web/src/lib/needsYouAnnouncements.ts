import type { InboxItem } from "@runnerbox/contracts";

const KEEP = 500;
// More new items than this in one check get one notification between them, never a burst.
const AT_ONCE = 2;

// Which "Needs you" items to announce: those this device hasn't seen yet. With nothing seen yet,
// every current item counts as seen, so turning notifications on doesn't announce a backlog.
export function toAnnounce(ids: ReadonlyArray<string>, seen: ReadonlyArray<string> | null) {
  if (seen === null) return { announce: [], seen: ids.slice(-KEEP) };
  const known = new Set(seen);
  return { announce: ids.filter((id) => !known.has(id)), seen: [...new Set([...seen, ...ids])].slice(-KEEP) };
}

export type Announcement = { title: string; body: string; tag: string; itemId: string | null };

// The notifications for one check's new items: one each for a few, or one for them all, which
// opens home instead of an item.
export function announcements(items: ReadonlyArray<InboxItem>): Announcement[] {
  if (items.length > AT_ONCE) {
    return [{ title: `${items.length} things need you`, body: items.map((item) => item.title).join(", "), tag: "needs-you", itemId: null }];
  }
  return items.map((item) => ({ title: item.title, body: item.happened, tag: item.id, itemId: item.id }));
}
