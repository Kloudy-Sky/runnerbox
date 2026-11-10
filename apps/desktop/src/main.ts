import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { SavedEnvironment } from "@runnerbox/client-runtime";
import { app, BrowserWindow, type IpcMainInvokeEvent, ipcMain, protocol, safeStorage, session } from "electron";
import * as Schema from "effect/Schema";
import { createCatalog } from "./catalog.ts";
import { CHANNELS } from "./ipc/channels.ts";

// The desktop app is only a client: it serves the bundled web UI from disk and keeps saved
// environments. Every server it shows is reached over that server's own HTTP and WebSocket.

const SCHEME = "runnerbox";
const ORIGIN = `${SCHEME}://app`;
// Set by `pnpm dev:desktop` to load the UI from Vite instead of the built files.
const DEV_URL = process.env.RUNNERBOX_DESKTOP_DEV_URL;
const WEB_DIST = resolve(__dirname, "../../web/dist");
const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };

// A separate profile directory, for running the app without touching the usual one.
if (process.env.RUNNERBOX_DESKTOP_USER_DATA) app.setPath("userData", process.env.RUNNERBOX_DESKTOP_USER_DATA);

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, supportFetchAPI: true } }]);

const catalog = createCatalog(app.getPath("userData"), {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (text) => safeStorage.encryptString(text).toString("base64"),
  decrypt: (text) => safeStorage.decryptString(Buffer.from(text, "base64")),
});

const decodeEnvironment = Schema.decodeUnknownSync(SavedEnvironment);
const decodeId = Schema.decodeUnknownSync(Schema.String);

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
  // The UI never navigates away or opens windows; a link that tries is refused.
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(ORIGIN) && !(DEV_URL && url.startsWith(DEV_URL))) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  void window.loadURL(DEV_URL ?? `${ORIGIN}/index.html`);
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  serveBundledUi();
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
