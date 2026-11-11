import type { ClientPlatform } from "@runnerbox/client-runtime";
import { contextBridge, ipcRenderer } from "electron";
import { CHANNELS } from "./ipc/channels.ts";

// Electron wraps a failure in main as "Error invoking remote method '<channel>': Error: <message>",
// so the message the user needs is unwrapped.
const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, ""));
  });

// The one bridge the renderer gets. It runs sandboxed, so it only forwards calls to main, which
// checks every argument.
const bridge: ClientPlatform = {
  catalog: {
    list: () => invoke(CHANNELS.catalogList),
    save: (environment) => invoke(CHANNELS.catalogSave, environment),
    remove: (environmentId) => invoke(CHANNELS.catalogRemove, environmentId),
    canSaveTokens: () => invoke(CHANNELS.catalogCanSaveTokens),
  },
  connect: {
    status: () => invoke(CHANNELS.connectStatus),
    signIn: (relayUrl) => invoke(CHANNELS.connectSignIn, relayUrl),
    signOut: () => invoke(CHANNELS.connectSignOut),
    environments: () => invoke(CHANNELS.connectEnvironments),
    requestCredential: (environmentId, thumbprint) => invoke(CHANNELS.connectRequestCredential, environmentId, thumbprint),
    createProofKey: () => invoke(CHANNELS.connectCreateProofKey),
    prove: (keyId, request) => invoke(CHANNELS.connectProve, keyId, request),
  },
  ssh: {
    openTunnel: (route) => invoke(CHANNELS.sshOpenTunnel, route),
    closeTunnel: (route) => invoke(CHANNELS.sshCloseTunnel, route),
    fetchPairingCode: (route) => invoke(CHANNELS.sshFetchPairingCode, route),
  },
};

contextBridge.exposeInMainWorld("runnerbox", bridge);
