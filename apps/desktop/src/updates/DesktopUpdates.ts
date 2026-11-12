import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { UpdateChannel, type UpdateState } from "@runnerbox/client-runtime";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { defaultChannel, feedOf, isOffered } from "./channel.ts";
import { ElectronUpdater } from "./ElectronUpdater.ts";

// What the app around the updater supplies. `disabledReason` is why this build never checks: run
// from a checkout, built without a feed (an unsigned macOS build, or not by a release), a Linux
// build that isn't the AppImage, or RUNNERBOX_DISABLE_UPDATES.
export type UpdateHost = {
  readonly version: string;
  readonly userData: string;
  readonly disabledReason: string | null;
  readonly broadcast: (state: UpdateState) => void;
  readonly now: () => Date;
};

// The app's own updates, after T3 Code's DesktopUpdates (MIT, see THIRD_PARTY_NOTICES.md): check
// shortly after launch and every few hours, download in the background, then wait for the owner
// to restart. Nothing older than what runs is ever downloaded.
export class DesktopUpdates extends Context.Service<
  DesktopUpdates,
  {
    readonly state: Effect.Effect<UpdateState>;
    readonly setChannel: (channel: UpdateChannel) => Effect.Effect<void>;
    readonly check: Effect.Effect<void>;
    readonly install: Effect.Effect<void>;
  }
>()("runnerbox/desktop/updates/DesktopUpdates") {}

export const FIRST_CHECK = Duration.seconds(10);
export const EVERY = Duration.hours(4);

const Preferences = Schema.Struct({ channel: UpdateChannel });
const decodePreferences = Schema.decodeUnknownOption(Schema.fromJsonString(Preferences));

const make = (host: UpdateHost) =>
  Effect.gen(function* () {
    const updater = yield* ElectronUpdater;
    const preferencesPath = join(host.userData, "updates.json");
    const saved = decodePreferences(yield* Effect.promise(() => readFile(preferencesPath, "utf8").catch(() => "")));
    let state: UpdateState = {
      version: host.version,
      channel: saved._tag === "Some" ? saved.value.channel : defaultChannel(host.version),
      status: host.disabledReason === null ? "idle" : "disabled",
      message: host.disabledReason,
      pending: null,
      latest: null,
      checkedAt: null,
    };
    const set = (next: Partial<UpdateState>) =>
      Effect.sync(() => {
        state = { ...state, ...next };
        host.broadcast(state);
      });
    const lock = yield* Semaphore.make(1);
    // Bumped by each channel change, so a download that started on the old channel isn't offered.
    let generation = 0;

    const check = lock.withPermits(1)(
      Effect.gen(function* () {
        if (state.status === "disabled" || state.status === "ready") return;
        const started = generation;
        yield* set({ status: "checking", message: null });
        yield* updater.configure(feedOf(state.channel));
        const latest = yield* updater.check;
        const checkedAt = host.now().toISOString();
        if (latest === null || !isOffered(host.version, latest)) return yield* set({ status: "up-to-date", latest, checkedAt, pending: null });
        yield* set({ status: "downloading", latest, checkedAt, pending: latest });
        yield* updater.download;
        yield* generation === started ? set({ status: "ready" }) : set({ status: "idle", pending: null });
      }).pipe(Effect.catchTag("UpdaterError", (error) => set({ status: "error", message: `Couldn't check for updates: ${error.message}`, pending: null }))),
    );

    const setChannel = Effect.fn("DesktopUpdates.setChannel")(function* (channel: UpdateChannel) {
      if (channel === state.channel) return;
      generation += 1;
      yield* Effect.promise(() => writeFile(preferencesPath, JSON.stringify({ channel })));
      // An update downloaded from the other channel is never installed.
      yield* set({ channel, ...(state.status === "disabled" ? {} : { status: "idle", pending: null, latest: null, message: null }) });
      yield* Effect.forkDetach(check);
    });

    const install = Effect.suspend(() => (state.status === "ready" ? updater.quitAndInstall : Effect.void));

    if (host.disabledReason === null) {
      yield* Effect.forkScoped(Effect.sleep(FIRST_CHECK).pipe(Effect.andThen(check.pipe(Effect.repeat(Schedule.spaced(EVERY))))));
    }
    host.broadcast(state);
    return DesktopUpdates.of({ state: Effect.sync(() => state), setChannel, check, install });
  });

export const layer = (host: UpdateHost) => Layer.effect(DesktopUpdates, make(host));
