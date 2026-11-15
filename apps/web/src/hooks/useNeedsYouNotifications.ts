import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { useEffect } from "react";
import { announcements, toAnnounce } from "../lib/needsYouAnnouncements.ts";
import type { RootSearch } from "../lib/search.ts";
import { useActiveEnvironment } from "./useEnvironment.ts";
import { getLocalStorageItem, removeLocalStorageItem, setLocalStorageItem, useLocalStorage } from "./useLocalStorage.ts";
import { useRpcQuery } from "./useRpcQuery.ts";

const ENABLED_KEY = "runnerbox:notifications:needs-you";
const SEEN_KEY = "runnerbox:notifications:seen";
// What each environment's "Needs you" has shown, so one machine's items are never new on another.
const SeenByEnvironment = Schema.Record(Schema.String, Schema.Array(Schema.String));
// The same window the monitors watch, whatever range the page shows, so what counts as new
// doesn't change with navigation.
const DAYS = 14;

// Whether this device tells the owner about new "Needs you" items. Off until they turn it on.
export function useNotificationsSetting() {
  const [enabled, setEnabled] = useLocalStorage(ENABLED_KEY, false, Schema.Boolean);
  return {
    enabled,
    // Turning on starts from what's there now, so the items already waiting aren't announced.
    setEnabled: (next: boolean) => {
      if (next) removeLocalStorageItem(SEEN_KEY);
      setEnabled(next);
    },
  };
}

// While the setting is on and the system allows it, one notification for each new "Needs you"
// item, which opens that item when clicked, or one for several that opens home. The inbox is
// asked again every minute for this.
export function useNeedsYouNotifications() {
  const { enabled } = useNotificationsSetting();
  const environmentId = useActiveEnvironment().environment?.environmentId;
  const inbox = useRpcQuery(["inbox", DAYS], (client) => client["inbox.list"]({ days: DAYS }), { enabled, refetchEvery: 60_000 }).data;
  const navigate = useNavigate();
  // Showing a notification is a side effect outside React, made when the inbox changes.
  useEffect(() => {
    if (!enabled || !inbox || !environmentId || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const all = getLocalStorageItem(SEEN_KEY, SeenByEnvironment) ?? {};
    const { announce, seen } = toAnnounce(inbox.items.map((item) => item.id), all[environmentId] ?? null);
    setLocalStorageItem(SEEN_KEY, { ...all, [environmentId]: seen }, SeenByEnvironment);
    for (const { title, body, tag, itemId } of announcements(inbox.items.filter((item) => announce.includes(item.id)))) {
      const notification = new Notification(title, { body, tag });
      notification.onclick = () => {
        window.focus();
        void (itemId
          ? navigate({ to: "/item/$itemId", params: { itemId }, search: (previous: RootSearch) => previous })
          : navigate({ to: "/", search: (previous: RootSearch) => previous }));
      };
    }
  }, [enabled, inbox, environmentId, navigate]);
}
