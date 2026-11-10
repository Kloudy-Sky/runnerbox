import { type ClientPlatform, readSavedEnvironments } from "@runnerbox/client-runtime";

declare global {
  interface Window {
    // Set by the desktop app's preload. Absent in a plain browser.
    readonly runnerbox?: ClientPlatform;
  }
}

const KEY = "runnerbox.environments";

// A plain browser has no main process to keep tokens in, so they sit in this origin's local
// storage, and there are no SSH routes. The desktop app replaces both.
const browserPlatform: ClientPlatform = {
  catalog: {
    list: async () => {
      try {
        return readSavedEnvironments(JSON.parse(localStorage.getItem(KEY) ?? "[]"));
      } catch {
        return [];
      }
    },
    save: async (environment) => {
      const saved = (await browserPlatform.catalog.list()).filter((other) => other.environmentId !== environment.environmentId);
      localStorage.setItem(KEY, JSON.stringify([...saved, environment]));
    },
    remove: async (environmentId) => {
      const saved = (await browserPlatform.catalog.list()).filter((other) => other.environmentId !== environmentId);
      localStorage.setItem(KEY, JSON.stringify(saved));
    },
  },
};

export const platform = window.runnerbox ?? browserPlatform;
