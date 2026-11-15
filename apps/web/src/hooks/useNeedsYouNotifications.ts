import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { useEffect } from "react";
import { toAnnounce } from "../lib/needsYouAnnouncements.ts";
import type { RootSearch } from "../lib/search.ts";
import { getLocalStorageItem, removeLocalStorageItem, setLocalStorageItem, useLocalStorage } from "./useLocalStorage.ts";
import { useRange } from "./useRange.ts";
import { useRpcQuery } from "./useRpcQuery.ts";

const ENABLED_KEY = "runnerbox:notifications:needs-you";
const SEEN_KEY = "runnerbox:notifications:seen";
const SeenIds = Schema.Array(Schema.String);

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
// item, which opens that item when clicked. The inbox is asked again every minute for this.
export function useNeedsYouNotifications() {
  const { enabled } = useNotificationsSetting();
  const { days } = useRange();
  const inbox = useRpcQuery(["inbox", days], (client) => client["inbox.list"]({ days }), { enabled, refetchEvery: 60_000 }).data;
  const navigate = useNavigate();
  // Showing a notification is a side effect outside React, made when the inbox changes.
  useEffect(() => {
    if (!enabled || !inbox || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const { announce, seen } = toAnnounce(inbox.items.map((item) => item.id), getLocalStorageItem(SEEN_KEY, SeenIds));
    setLocalStorageItem(SEEN_KEY, seen, SeenIds);
    for (const item of inbox.items.filter((candidate) => announce.includes(candidate.id))) {
      const notification = new Notification(item.title, { body: item.happened, tag: item.id });
      notification.onclick = () => {
        window.focus();
        void navigate({ to: "/item/$itemId", params: { itemId: item.id }, search: (previous: RootSearch) => previous });
      };
    }
  }, [enabled, inbox, navigate]);
}
