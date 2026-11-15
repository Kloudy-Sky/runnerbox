import { constants } from "node:fs";
import { access, mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { ServerUpdateError, type UpdateBlocker, type UpdateOutcome, type UpdateProgress, type UpdateStatus } from "@runnerbox/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import packageJson from "../../package.json" with { type: "json" };
import * as Threads from "../threads/Threads.ts";
import { DownloadError, downloadRelease, fetchChecksum, type ReleaseSource } from "./download.ts";
import * as Supervision from "./Supervision.ts";
import { readRecord, updatePaths } from "./supervisor/updateFiles.ts";
import { compareVersions } from "./supervisor/version.ts";

const BLOCKED: Record<UpdateBlocker, string> = {
  checkout: "This server was built from a checkout, so it has no releases to update from. Update it with git.",
  unsupervised: "This server wasn't started with runnerbox serve, so it can't restart itself on a new version.",
  "not-writable": "This server can't replace its own runnerbox.js, because its folder isn't writable.",
  updating: "An update is already running.",
  "turn-running": "A thread's agent is answering. Stop the agent's turn, then update.",
  "monitor-running": "A monitor is looking into an item, which counts as an agent's turn. Stop it in that item's thread, then update.",
  "reproduce-running": "A reproduce container is running. Stop it in its thread, then update.",
};

const blocked = (reason: UpdateBlocker) => new ServerUpdateError({ reason, detail: BLOCKED[reason] });

// A download that stalls is given up on rather than left holding the update.
const DOWNLOAD_TIMEOUT = Duration.minutes(10);
// How often a download's progress is passed on.
const PROGRESS_BYTES = 256 * 1024;

type JobState =
  | { readonly _tag: "Running"; readonly progress: UpdateProgress }
  | { readonly _tag: "Started"; readonly updateId: string }
  | { readonly _tag: "Failed"; readonly error: ServerUpdateError };

// Moving this server to a newer release, as the app asks: download it beside runnerbox.js, check
// its checksum, and hand it to the supervisor, which checks it runs, restarts the server on it,
// and puts it in place only once it's ready. One update runs at a time; it carries on if the
// client that asked goes away, and another client asking for the same version follows it.
export class ServerUpdate extends Context.Service<
  ServerUpdate,
  {
    readonly status: Effect.Effect<UpdateStatus>;
    readonly update: (version: string) => Stream.Stream<UpdateProgress, ServerUpdateError>;
  }
>()("runnerbox/server/update/ServerUpdate") {}

const SERVER_VERSION = packageJson.version;

// Until a job ends, each state as it comes: progress, then `Starting` or the error.
const follow = (state: SubscriptionRef.SubscriptionRef<JobState>) =>
  SubscriptionRef.changes(state).pipe(
    Stream.takeUntil((each) => each._tag !== "Running"),
    Stream.mapEffect((each): Effect.Effect<UpdateProgress, ServerUpdateError> =>
      each._tag === "Running" ? Effect.succeed(each.progress) : each._tag === "Started" ? Effect.succeed({ _tag: "Starting", updateId: each.updateId }) : Effect.fail(each.error),
    ),
  );

const toOutcome = (record: NonNullable<Awaited<ReturnType<typeof readRecord>>>): UpdateOutcome => ({
  id: record.id,
  from: record.from,
  to: record.to,
  status: record.status,
  startedAt: record.startedAt,
  ...(record.reason === undefined ? {} : { reason: record.reason }),
  ...(record.finishedAt === undefined ? {} : { finishedAt: record.finishedAt }),
});

const fromDownload = (error: unknown) =>
  error instanceof DownloadError
    ? new ServerUpdateError({ reason: error.kind, detail: error.message })
    : new ServerUpdateError({ reason: "download-failed", detail: `The download failed: ${error instanceof Error ? error.message : String(error)}` });

// `source` is null for a build from a checkout, which has no releases.
const make = (source: ReleaseSource | null) =>
  Effect.gen(function* () {
    const supervision = yield* Supervision.Supervision;
    const threads = yield* Threads.Threads;
    const scope = yield* Effect.scope;
    const file = supervision.context?.file ?? null;
    let job: { readonly version: string; readonly state: SubscriptionRef.SubscriptionRef<JobState> } | null = null;

    // What a restart would cut short.
    const blockerOf = ({ turn, reproduce }: Threads.Busy): UpdateBlocker | null =>
      turn === "owner" ? "turn-running" : turn === "monitor" ? "monitor-running" : reproduce ? "reproduce-running" : null;
    const busy = Effect.map(threads.busy, blockerOf);
    // Two calls arriving together decide one at a time, so only one starts a job.
    const starting = yield* Semaphore.make(1);

    const blocker = Effect.gen(function* () {
      if (source === null) return "checkout" as const;
      if (file === null) return "unsupervised" as const;
      if (job !== null) return "updating" as const;
      const writable = yield* Effect.promise(() => access(dirname(file), constants.W_OK).then(() => true, () => false));
      if (!writable) return "not-writable" as const;
      return yield* busy;
    });

    const status = Effect.gen(function* () {
      const record = file === null ? null : yield* Effect.promise(() => readRecord(updatePaths(file).record));
      return { serverVersion: SERVER_VERSION, blocker: yield* blocker, lastUpdate: record === null ? null : toOutcome(record) };
    });

    const run = (releases: ReleaseSource, installed: string, version: string, state: SubscriptionRef.SubscriptionRef<JobState>) =>
      Effect.gen(function* () {
        const paths = updatePaths(installed);
        const staged = paths.staged(version);
        const partial = `${staged}.part`;
        yield* Effect.promise(() => mkdir(paths.dir, { recursive: true, mode: 0o700 }));
        const sha256 = yield* Effect.tryPromise({
          try: async (signal) => {
            const expected = await fetchChecksum(releases, version, signal);
            let reported = 0;
            const actual = await downloadRelease(
              releases,
              version,
              partial,
              (received, total) => {
                if (received - reported < PROGRESS_BYTES && received !== total) return;
                reported = received;
                Effect.runSync(SubscriptionRef.set(state, { _tag: "Running", progress: { _tag: "Downloading", received, total } }));
              },
              signal,
            );
            return { expected, actual };
          },
          catch: fromDownload,
        }).pipe(
          Effect.timeoutOrElse({ duration: DOWNLOAD_TIMEOUT, orElse: () => Effect.fail(new ServerUpdateError({ reason: "download-failed", detail: "The download took more than 10 minutes, so it was stopped." })) }),
        );
        if (sha256.actual !== sha256.expected) return yield* new ServerUpdateError({ reason: "checksum-mismatch", detail: "The download didn't match its checksum, so nothing was installed." });
        yield* Effect.tryPromise({ try: () => rename(partial, staged), catch: fromDownload });
        yield* SubscriptionRef.set(state, { _tag: "Running", progress: { _tag: "Checking" } });
        // The download took a while, and something may have started since. From here until the
        // restart nothing new starts, unless the update doesn't go ahead.
        const now = blockerOf(yield* threads.holdForRestart);
        if (now !== null) return yield* Effect.andThen(threads.resume, Effect.fail(blocked(now)));
        const updateId = yield* supervision.requestUpdate({ version, path: staged, sha256: sha256.actual }).pipe(
          Effect.tapError(() => threads.resume),
          Effect.mapError((refused) => new ServerUpdateError({ reason: "refused", detail: refused.reason })),
        );
        yield* SubscriptionRef.set(state, { _tag: "Started", updateId });
      }).pipe(
        // A started update keeps its job: the server stops in a moment, and nothing else may start.
        Effect.tapError((error) =>
          Effect.promise(() => Promise.all([rm(`${updatePaths(installed).staged(version)}.part`, { force: true }), rm(updatePaths(installed).staged(version), { force: true })])).pipe(
            Effect.andThen(Effect.sync(() => (job = null))),
            Effect.andThen(SubscriptionRef.set(state, { _tag: "Failed", error })),
          ),
        ),
        Effect.ignore,
      );

    const update = (version: string) =>
      Stream.unwrap(
        starting.withPermits(1)(
          Effect.gen(function* () {
            if (job?.version === version) return follow(job.state);
            const reason = yield* blocker;
            if (reason !== null) return Stream.fail(blocked(reason));
            if (source === null || file === null) return Stream.fail(blocked(source === null ? "checkout" : "unsupervised"));
            if (compareVersions(version, SERVER_VERSION) <= 0) {
              return Stream.fail(new ServerUpdateError({ reason: "not-newer", detail: `This server runs ${SERVER_VERSION}, and ${version} isn't newer. An update never goes back.` }));
            }
            const state = yield* SubscriptionRef.make<JobState>({ _tag: "Running", progress: { _tag: "Downloading", received: 0, total: null } });
            job = { version, state };
            yield* run(source, file, version, state).pipe(Effect.forkIn(scope));
            return follow(state);
          }),
        ),
      );

    return ServerUpdate.of({ status, update });
  });

export const layer = (source: ReleaseSource | null) => Layer.effect(ServerUpdate, make(source));
