import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import electronUpdater from "electron-updater";
import { ElectronUpdater, UpdaterError } from "./ElectronUpdater.ts";

const failed = (cause: unknown) => new UpdaterError({ message: cause instanceof Error ? cause.message : String(cause) });

// Reached only once DesktopUpdates has found a feed, since on Linux the updater exists only
// inside an AppImage.
export const layer = Layer.sync(ElectronUpdater, () => {
  const updater = () => electronUpdater.autoUpdater;
  return ElectronUpdater.of({
    configure: (feed) =>
      Effect.sync(() => {
        const autoUpdater = updater();
        autoUpdater.logger = null;
        autoUpdater.autoDownload = false;
        autoUpdater.autoInstallOnAppQuit = false;
        autoUpdater.channel = feed.channel;
        autoUpdater.allowPrerelease = feed.allowPrerelease;
        // Setting the channel turns downgrades on, so this comes after it.
        autoUpdater.allowDowngrade = false;
      }),
    check: Effect.tryPromise({ try: () => updater().checkForUpdates(), catch: failed }).pipe(Effect.map((result) => result?.updateInfo.version ?? null)),
    download: Effect.tryPromise({ try: () => updater().downloadUpdate(), catch: failed }).pipe(Effect.asVoid),
    quitAndInstall: Effect.sync(() => updater().quitAndInstall(false, true)),
  });
});
