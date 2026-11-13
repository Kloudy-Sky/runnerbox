import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { SavedEnvironment, SshRoute, UpdateChannel } from "@runnerbox/client-runtime";
import { app, BrowserWindow, type IpcMainInvokeEvent, ipcMain, protocol, safeStorage, session, shell } from "electron";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Schema from "effect/Schema";
import { createCatalog, type TokenCipher } from "./catalog.ts";
import { createConnect } from "./connect.ts";
import { opensInBrowser } from "./externalLinks.ts";
import { CHANNELS } from "./ipc/channels.ts";
import { createTunnels } from "./ssh/tunnels.ts";
import { DesktopUpdates, layer as desktopUpdatesLayer } from "./updates/DesktopUpdates.ts";
import { layer as electronUpdaterLayer } from "./updates/electronUpdaterLive.ts";

// The desktop app is only a client: it serves the bundled web UI from disk and keeps saved
// environments. Every server it shows is reached over that server's own HTTP and WebSocket.

const SCHEME = "runnerbox";
const ORIGIN = `${SCHEME}://app`;
// Set by `pnpm dev:desktop` to load the UI from Vite instead of the built files.
const DEV_URL = process.env.RUNNERBOX_DESKTOP_DEV_URL;
// The built web client: inside the app when packaged (scripts/dist.ts puts it there), or the
// workspace's own build when run from a checkout.
const WEB_DIST = app.isPackaged ? join(__dirname, "web") : resolve(__dirname, "../../web/dist");
const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };

// A separate profile directory, for running the app without touching the usual one.
if (process.env.RUNNERBOX_DESKTOP_USER_DATA) app.setPath("userData", process.env.RUNNERBOX_DESKTOP_USER_DATA);

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, supportFetchAPI: true } }]);

const cipher: TokenCipher = {
  // On Linux with no keyring, Electron falls back to a fixed key ("basic_text"), which is plaintext
  // in all but name, so that counts as unavailable.
  available: () => safeStorage.isEncryptionAvailable() && !(process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text"),
  encrypt: (text) => safeStorage.encryptString(text).toString("base64"),
  decrypt: (text) => safeStorage.decryptString(Buffer.from(text, "base64")),
};
const catalog = createCatalog(app.getPath("userData"), cipher);
// Sign-in opens the system browser, which holds the user's Clerk session; only https URLs leave.
const connect = createConnect(app.getPath("userData"), cipher, (url) => {
  if (url.startsWith("https://")) void shell.openExternal(url);
});
const isRelayUrl = Schema.is(Schema.String.check(Schema.isPattern(/^https:\/\/[^\s/]+(\/.*)?$/)));
const decodeRelayUrl = (value: unknown) => {
  if (!isRelayUrl(value)) throw new Error("The relay address must start with https://.");
  return value;
};

const decodeEnvironment = Schema.decodeUnknownSync(SavedEnvironment);
const decodeId = Schema.decodeUnknownSync(Schema.String);
const decodeRoute = Schema.decodeUnknownSync(SshRoute);
const decodeProofRequest = Schema.decodeUnknownSync(Schema.Struct({ method: Schema.String, url: Schema.String }));
const tunnels = createTunnels();

// Why this build never updates itself, or null when it has a feed to check. A release build
// carries `app-update.yml`, naming its feed; one from a checkout, or an unsigned macOS build, has none.
function updatesDisabledReason() {
  if (!app.isPackaged || DEV_URL) return "This build runs from a checkout, so it doesn't update itself.";
  if (process.env.RUNNERBOX_DISABLE_UPDATES) return "RUNNERBOX_DISABLE_UPDATES turns updates off for this app.";
  if (process.platform === "linux" && !process.env.APPIMAGE) return "Only the AppImage updates itself.";
  if (!existsSync(join(process.resourcesPath, "app-update.yml"))) return "This build has no update feed: it's unsigned, or wasn't built by a release.";
  return null;
}
const decodeChannel = Schema.decodeUnknownSync(UpdateChannel);
const updates = ManagedRuntime.make(
  desktopUpdatesLayer({
    version: app.getVersion(),
    userData: app.getPath("userData"),
    disabledReason: updatesDisabledReason(),
    broadcast: (state) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send(CHANNELS.updatesState, state);
    },
    now: () => new Date(),
  }).pipe(Layer.provide(electronUpdaterLayer)),
);
const withUpdates = <A>(use: (service: DesktopUpdates["Service"]) => Effect.Effect<A>) => updates.runPromise(Effect.flatMap(DesktopUpdates, use));

// Only the app's own page may call main; anything else that loads in a window gets nothing.
const fromApp = (event: IpcMainInvokeEvent) => {
  const url = event.senderFrame?.url ?? "";
  if (!url.startsWith(`${ORIGIN}/`) && !(DEV_URL && url.startsWith(DEV_URL))) throw new Error("IPC from an unknown page");
};

function registerIpc() {
  ipcMain.handle(CHANNELS.catalogList, (event) => {
    fromApp(event);
    return catalog.list();
  });
  ipcMain.handle(CHANNELS.catalogSave, (event, environment: unknown) => {
    fromApp(event);
    return catalog.save(decodeEnvironment(environment));
  });
  ipcMain.handle(CHANNELS.catalogRemove, (event, environmentId: unknown) => {
    fromApp(event);
    return catalog.remove(decodeId(environmentId));
  });
  ipcMain.handle(CHANNELS.catalogCanSaveTokens, (event) => {
    fromApp(event);
    return cipher.available();
  });
  ipcMain.handle(CHANNELS.connectStatus, (event) => {
    fromApp(event);
    return connect.status();
  });
  ipcMain.handle(CHANNELS.connectSignIn, (event, relayUrl: unknown) => {
    fromApp(event);
    return connect.signIn(decodeRelayUrl(relayUrl));
  });
  ipcMain.handle(CHANNELS.connectSignOut, (event) => {
    fromApp(event);
    return connect.signOut();
  });
  ipcMain.handle(CHANNELS.connectEnvironments, (event) => {
    fromApp(event);
    return connect.environments();
  });
  ipcMain.handle(CHANNELS.connectRequestCredential, (event, environmentId: unknown, thumbprint: unknown) => {
    fromApp(event);
    return connect.requestCredential(decodeId(environmentId), decodeId(thumbprint));
  });
  ipcMain.handle(CHANNELS.connectCreateProofKey, (event) => {
    fromApp(event);
    return connect.createProofKey();
  });
  ipcMain.handle(CHANNELS.connectProve, (event, keyId: unknown, request: unknown) => {
    fromApp(event);
    return connect.prove(decodeId(keyId), decodeProofRequest(request));
  });
  ipcMain.handle(CHANNELS.updatesGetState, (event) => {
    fromApp(event);
    return withUpdates((service) => service.state);
  });
  ipcMain.handle(CHANNELS.updatesSetChannel, (event, channel: unknown) => {
    fromApp(event);
    const picked = decodeChannel(channel);
    return withUpdates((service) => service.setChannel(picked));
  });
  ipcMain.handle(CHANNELS.updatesCheck, (event) => {
    fromApp(event);
    return withUpdates((service) => service.check);
  });
  ipcMain.handle(CHANNELS.updatesInstall, (event) => {
    fromApp(event);
    return withUpdates((service) => service.install);
  });
  ipcMain.handle(CHANNELS.sshOpenTunnel, (event, route: unknown) => {
    fromApp(event);
    return tunnels.open(decodeRoute(route));
  });
  ipcMain.handle(CHANNELS.sshCloseTunnel, (event, route: unknown) => {
    fromApp(event);
    tunnels.close(decodeRoute(route));
  });
  ipcMain.handle(CHANNELS.sshFetchPairingCode, (event, route: unknown) => {
    fromApp(event);
    return tunnels.fetchPairingCode(decodeRoute(route));
  });
}

// Serves the built UI, refusing any path that escapes its directory.
function serveBundledUi() {
  protocol.handle(SCHEME, async (request) => {
    const { pathname } = new URL(request.url);
    const file = normalize(join(WEB_DIST, pathname === "/" ? "index.html" : decodeURIComponent(pathname)));
    if (!file.startsWith(WEB_DIST + sep)) return new Response("Not found", { status: 404 });
    try {
      return new Response(await readFile(file), { headers: { "content-type": MIME[extname(file)] ?? "application/octet-stream" } });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 900,
    minHeight: 560,
    title: "runnerbox",
    backgroundColor: "#141414",
    webPreferences: { preload: join(__dirname, "preload.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  // The UI never navigates away or opens windows; a link that tries is refused, except a GitHub
  // page opened in a new window, which goes to the system browser.
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(ORIGIN) && !(DEV_URL && url.startsWith(DEV_URL))) event.preventDefault();
  });
  // A link to a GitHub page, such as a run to rerun, opens in the system browser instead.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (opensInBrowser(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  void window.loadURL(DEV_URL ?? `${ORIGIN}/index.html`);
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  serveBundledUi();
  registerIpc();
  createWindow();
  // Starts the schedule of checks.
  void withUpdates((service) => service.state);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Forwards die with the app; the servers they reach keep running.
app.on("will-quit", () => tunnels.closeAll());

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
