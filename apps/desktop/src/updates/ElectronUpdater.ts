import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export class UpdaterError extends Schema.TaggedError<UpdaterError>()("UpdaterError", { message: Schema.String }) {}

// electron-updater's autoUpdater, as T3 Code wraps it (MIT, see THIRD_PARTY_NOTICES.md): only the
// calls DesktopUpdates makes. It installs only what a feed's manifest names, after checking its
// sha512; on macOS, Squirrel.Mac also requires the running app's signature.
export class ElectronUpdater extends Context.Service<
  ElectronUpdater,
  {
    // Points it at a channel's feed. Never downloads or installs on its own, and never downgrades.
    readonly configure: (feed: { readonly channel: "latest" | "nightly"; readonly allowPrerelease: boolean }) => Effect.Effect<void>;
    // The feed's newest version, or null when the feed has nothing for this platform.
    readonly check: Effect.Effect<string | null, UpdaterError>;
    readonly download: Effect.Effect<void, UpdaterError>;
    readonly quitAndInstall: Effect.Effect<void>;
  }
>()("runnerbox/desktop/updates/ElectronUpdater") {}
