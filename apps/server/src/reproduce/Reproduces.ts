import { type ReproduceCheck, ReproduceError, type ReproduceNetwork } from "@runnerbox/contracts";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import type * as StateLogs from "../history/StateLogs.ts";
import { reproduceTarget } from "./reproduceTarget.ts";
import { type Executed, UpSocket } from "./UpSocket.ts";

export class ExecFailed extends Data.TaggedError("ExecFailed")<{ readonly why: string; readonly endedHere: boolean }> {}

type Running = { readonly install: string; readonly upId: string };
export type ReproduceStart = { readonly kind: string; readonly commit: string; readonly image: string; readonly imageFallback: boolean };

// `up` says these when the reproduce is gone: removed for real jobs' memory, idle, too old, or
// after a failed network cut. Anything else leaves it running.
const GONE = /^This reproduce ended|^No reproduce has that id|was removed\.$/;

// Each thread's running reproduce, and which turn may run commands in it. A turn's MCP token is
// bound to its thread for the turn, so a token from another thread, from a turn without a
// reproduce, or from `runnerbox mcp-token` reaches nothing.
export class Reproduces extends Context.Service<
  Reproduces,
  {
    readonly check: (packet: string, jobId: number | null) => Effect.Effect<ReproduceCheck>;
    readonly start: (threadId: string, packet: string, jobId: number | null, network: ReproduceNetwork) => Effect.Effect<ReproduceStart, ReproduceError>;
    readonly running: (threadId: string) => boolean;
    // Whether this server started the thread's reproduce, running or not. One it didn't was
    // started before a restart, and nothing tracks it now.
    readonly startedHere: (threadId: string) => boolean;
    // Why it ended, to log: the owner stopped it, or `up` had already removed it and says why.
    // Null when the thread had none running.
    readonly stop: (threadId: string) => Effect.Effect<string | null, ReproduceError>;
    // For the turn's lifetime, lets `sessionId`'s token run commands in the thread's reproduce.
    readonly bind: (sessionId: string, threadId: string) => Effect.Effect<void, never, Scope.Scope>;
    readonly boundThread: (sessionId: string) => string | undefined;
    // `endedHere` is set on the one failure that found the reproduce gone, so its end is logged once.
    readonly exec: (threadId: string, command: string, timeoutSec: number) => Effect.Effect<Executed, ExecFailed>;
  }
>()("runnerbox/server/reproduce/Reproduces") {}

const make = Effect.gen(function* () {
  const up = yield* UpSocket;
  const logs = yield* Effect.context<StateLogs.StateLogs>();
  const running = new Map<string, Running>();
  const bindings = new Map<string, string>();
  const startedHere = new Set<string>();

  const check = (packet: string, jobId: number | null) =>
    reproduceTarget(packet, jobId).pipe(
      Effect.map((target): ReproduceCheck => (target._tag === "NotReady" ? target : { _tag: "Ready", kind: target.kind, commit: target.commit, imageRecorded: target.image !== null })),
      Effect.provideContext(logs),
    );

  const start = Effect.fn("Reproduces.start")(function* (threadId: string, packet: string, jobId: number | null, network: ReproduceNetwork) {
    if (running.has(threadId)) return yield* new ReproduceError({ why: "This thread already has a reproduce running." });
    const target = yield* reproduceTarget(packet, jobId).pipe(Effect.provideContext(logs));
    if (target._tag === "NotReady") return yield* new ReproduceError({ why: target.why });
    const started = yield* up.start(target.install, {
      op: "start",
      repo: target.repo,
      commit: target.commit,
      kind: target.kind,
      // Only ever the runner event's own tag; see reproduceTarget.
      ...(target.image === null ? {} : { image: target.image }),
      network,
    });
    running.set(threadId, { install: target.install, upId: started.id });
    startedHere.add(threadId);
    return { kind: target.kind, commit: target.commit, image: started.image, imageFallback: target.image === null || started.imageFallback };
  });

  const stop = Effect.fn("Reproduces.stop")(function* (threadId: string) {
    const current = running.get(threadId);
    if (!current) return null;
    running.delete(threadId);
    return yield* up.stop(current.install, current.upId).pipe(
      Effect.as("The owner stopped it."),
      Effect.catchIf((error) => GONE.test(error.why), (error) => Effect.succeed(error.why)),
    );
  });

  const bind = (sessionId: string, threadId: string) =>
    Effect.acquireRelease(
      Effect.sync(() => bindings.set(sessionId, threadId)),
      () => Effect.sync(() => bindings.delete(sessionId)),
    ).pipe(Effect.asVoid);

  const exec = Effect.fn("Reproduces.exec")(function* (threadId: string, command: string, timeoutSec: number) {
    const current = running.get(threadId);
    if (!current) return yield* new ExecFailed({ why: "This thread has no reproduce running. The owner can start one with Reproduce.", endedHere: false });
    // The command travels as data in the request; `up` hands it to the container on stdin.
    return yield* up.exec(current.install, { op: "exec", id: current.upId, command, timeoutSec }).pipe(
      Effect.mapError((error) => {
        const endedHere = GONE.test(error.why) && running.get(threadId) === current;
        if (endedHere) running.delete(threadId);
        return new ExecFailed({ why: error.why, endedHere });
      }),
    );
  });

  return Reproduces.of({ check, start, running: (threadId) => running.has(threadId), startedHere: (threadId) => startedHere.has(threadId), stop, bind, boundThread: (sessionId) => bindings.get(sessionId), exec });
});

export const layer = Layer.effect(Reproduces, make);
