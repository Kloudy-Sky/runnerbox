import type { ClientPlatform } from "@runnerbox/client-runtime";
import { contextBridge, ipcRenderer } from "electron";
import { CHANNELS } from "./ipc/channels.ts";

// The one bridge the renderer gets. It runs sandboxed, so it only forwards calls to main, which
// checks every argument.
const bridge: ClientPlatform = {
  catalog: {
    list: () => ipcRenderer.invoke(CHANNELS.catalogList),
    save: (environment) => ipcRenderer.invoke(CHANNELS.catalogSave, environment),
    remove: (environmentId) => ipcRenderer.invoke(CHANNELS.catalogRemove, environmentId),
  },
};

contextBridge.exposeInMainWorld("runnerbox", bridge);
