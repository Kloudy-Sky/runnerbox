import { join } from "node:path";
import { type RunnerRestart, RunnerRestartError } from "@runnerbox/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { RESTARTS_OFF } from "runnerbox/src/control/protocol.ts";
import * as ServerPaths from "../config/ServerPaths.ts";
import * as UpSocket from "../reproduce/UpSocket.ts";

// The lines of `up`'s `changes.ndjson` that say how a restart the owner asked for ended.
const RestartLine = Schema.Struct({
  kind: Schema.Literal("restart"),
  time: Schema.String,
  outcome: Schema.Literals(["waiting", "restarted", "not_restarted"]),
  reason: Schema.optionalKey(Schema.String),
});
const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(RestartLine));

// Restarting an install's runners from the app, through its control socket: `up` waits for a
// moment with no job running, then drains, so its service manager starts it on the current
// runnerbox.js. Only an install with `"changes": true` takes it.
export class RunnerRestarts extends Context.Service<
  RunnerRestarts,
  {
    readonly status: (install: string) => Effect.Effect<RunnerRestart>;
    readonly restartWhenIdle: (install: string, requestedBy: { readonly session: string; readonly label: string }) => Effect.Effect<RunnerRestart, RunnerRestartError>;
  }
>()("runnerbox/server/runners/RunnerRestarts") {}

const make = Effect.gen(function* () {
  const up = yield* UpSocket.UpSocket;
  const fs = yield* FileSystem.FileSystem;
  const { stateDir } = yield* ServerPaths.ServerPaths;

  const last = (install: string) =>
    fs.readFileString(join(stateDir, install, "changes.ndjson")).pipe(
      Effect.map((text) => {
        const ended = text
          .split("\n")
          .flatMap((line) => {
            const entry = decodeLine(line);
            return entry._tag === "Some" && entry.value.outcome !== "waiting" ? [entry.value] : [];
          })
          .at(-1);
        if (ended === undefined || ended.outcome === "waiting") return null;
        return { outcome: ended.outcome, at: ended.time, ...(ended.reason === undefined ? {} : { reason: ended.reason }) };
      }),
      Effect.orElseSucceed(() => null),
    );

  const status = Effect.fn("RunnerRestarts.status")(function* (install: string) {
    const ended = yield* last(install);
    return yield* up.restartStatus(install).pipe(
      Effect.map((waiting): RunnerRestart => ({ install, available: true, unavailable: null, waiting, last: ended })),
      // Only the owner's own switch is worth a sentence; anything else, such as a Runnerbox too old
      // to be asked or not running, leaves the command alone.
      Effect.catchTag("ReproduceError", (error) =>
        Effect.succeed<RunnerRestart>({ install, available: false, unavailable: error.why === RESTARTS_OFF ? RESTARTS_OFF : null, waiting: null, last: ended }),
      ),
    );
  });

  const restartWhenIdle = Effect.fn("RunnerRestarts.restartWhenIdle")(function* (install: string, requestedBy: { readonly session: string; readonly label: string }) {
    const waiting = yield* up.restart(install, requestedBy).pipe(Effect.mapError((error) => new RunnerRestartError({ why: error.why })));
    return { install, available: true, unavailable: null, waiting, last: yield* last(install) };
  });

  return RunnerRestarts.of({ status, restartWhenIdle });
});

export const layer = Layer.effect(RunnerRestarts, make);
