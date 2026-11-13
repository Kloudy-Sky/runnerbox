import { lstat } from "node:fs/promises";
import { connect } from "node:net";
import { dirname, join } from "node:path";
import { ReproduceError } from "@runnerbox/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { ProposedChange } from "@runnerbox/contracts";
import type { ApplyRequest, ControlRequest } from "runnerbox/src/control/protocol.ts";
import { controlSocketPath, legacyReproduceSocketPath } from "runnerbox/src/control/socket.ts";
import type { ReproduceRequest } from "runnerbox/src/reproduce/protocol.ts";
import * as ServerPaths from "../config/ServerPaths.ts";

// A field a proposal may change, as `up` describes it: its value now and the bounds `up` enforces.
const Field = Schema.Struct({
  path: Schema.String,
  value: Schema.Union([Schema.Number, Schema.String]),
  min: Schema.Number,
  max: Schema.Number,
  unit: Schema.Literals(["slots", "MiB", "size", "cpus"]),
});
export type Field = typeof Field.Type;

// `up`'s answers, checked like any other input, though only this user can write the socket.
const Answer = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), id: Schema.String, image: Schema.String, imageFallback: Schema.Boolean }),
  Schema.Struct({ ok: Schema.Literal(true), exitCode: Schema.NullOr(Schema.Int), output: Schema.String, truncated: Schema.Boolean, timedOut: Schema.Boolean, commandsLeft: Schema.Int }),
  Schema.Struct({ ok: Schema.Literal(true), stopped: Schema.Literal(true) }),
  Schema.Struct({ ok: Schema.Literal(true), running: Schema.Literal(true) }),
  Schema.Struct({ ok: Schema.Literal(true), running: Schema.Literal(false), reason: Schema.String }),
  Schema.Struct({ ok: Schema.Literal(true), install: Schema.String, fields: Schema.Array(Field), pending: Schema.NullOr(Schema.Struct({ proposalId: Schema.String, when: Schema.Literals(["idle", "now"]), since: Schema.String })) }),
  Schema.Struct({ ok: Schema.Literal(true), accepted: Schema.Literal(true), when: Schema.Literals(["idle", "now"]) }),
  Schema.Struct({ ok: Schema.Literal(false), error: Schema.String }),
]);
type Answer = typeof Answer.Type;
const decodeAnswer = Schema.decodeUnknownEffect(Schema.fromJsonString(Answer));

export type Started = Extract<Answer, { id: string }>;
export type Executed = Extract<Answer, { exitCode: number | null }>;
export type Described = Extract<Answer, { fields: ReadonlyArray<Field> }>;
export type ApprovedChange = Omit<ApplyRequest, "op" | "changes"> & { readonly changes: ReadonlyArray<ProposedChange> };

// An install's name came from its own directory, but it still only names one under the state directory.
const INSTALL = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_ANSWER_BYTES = 64 * 1024;

// Talks to one install's `up` over `<state>/<install>/control/up.sock`: one JSON line out, one
// back. Before connecting it checks that the directory and the socket are this user's alone, so
// another user can't stand in for `up`. An `up` from before the control socket answers reproduce at
// `reproduce/up.sock`, tried for one release when there's no control socket.
export class UpSocket extends Context.Service<
  UpSocket,
  {
    readonly start: (install: string, request: Extract<ReproduceRequest, { op: "start" }>) => Effect.Effect<Started, ReproduceError>;
    readonly exec: (install: string, request: Extract<ReproduceRequest, { op: "exec" }>) => Effect.Effect<Executed, ReproduceError>;
    readonly stop: (install: string, id: string) => Effect.Effect<void, ReproduceError>;
    // Null while it runs; why it ended once `up` removed it.
    readonly status: (install: string, id: string) => Effect.Effect<string | null, ReproduceError>;
    // The fields a proposal may change, with their values and bounds, and any change waiting.
    readonly describe: (install: string) => Effect.Effect<Described, ReproduceError>;
    // Hands an approved change to `up`, which checks it all again itself, against its own schema.
    readonly apply: (install: string, change: ApprovedChange) => Effect.Effect<{ readonly when: "idle" | "now" }, ReproduceError>;
  }
>()("runnerbox/server/reproduce/UpSocket") {}

const uid = () => process.getuid?.() ?? -1;

export async function checkOwnership(path: string) {
  for (const [what, entry, kind] of [["Its directory", dirname(path), "directory"], ["The socket", path, "socket"]] as const) {
    const found = await lstat(entry).catch(() => null);
    if (!found) throw new Error("That install's up has no control socket. Turn on reproduce or changes in its config and restart it.");
    if (kind === "directory" ? !found.isDirectory() : !found.isSocket()) throw new Error(`${what} isn't a ${kind}, so the server won't use it.`);
    if (found.uid !== uid()) throw new Error(`${what} belongs to another user, so the server won't use it.`);
    if ((found.mode & 0o077) !== 0) throw new Error(`${what} is open to other users, so the server won't use it.`);
  }
}

// The control socket, or for one release, the reproduce socket of an `up` that has no control socket.
async function socketOf(installDir: string) {
  const control = controlSocketPath(installDir);
  return (await lstat(dirname(control)).catch(() => null)) ? control : legacyReproduceSocketPath(installDir);
}

function ask(path: string, request: ControlRequest | ({ op: "apply" } & ApprovedChange), timeoutMs: number) {
  return new Promise<string>((resolve, reject) => {
    const socket = connect(path);
    let received = "";
    socket.setEncoding("utf8");
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error("up didn't answer in time.")));
    socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk: string) => {
      received += chunk;
      if (received.length > MAX_ANSWER_BYTES) socket.destroy(new Error("up's answer was too large."));
      const newline = received.indexOf("\n");
      if (newline >= 0) {
        socket.end();
        resolve(received.slice(0, newline));
      }
    });
    socket.on("error", (error) => reject(error));
    socket.on("close", () => reject(new Error("up closed the socket without answering.")));
  });
}

// Long enough for `up` to fetch and unpack a commit, or for a command to reach its own timeout.
const START_MS = 6 * 60_000;
const QUICK_MS = 60_000;

const make = Effect.gen(function* () {
  const { stateDir } = yield* ServerPaths.ServerPaths;

  const send = Effect.fn("UpSocket.send")(function* (install: string, request: ControlRequest | ({ op: "apply" } & ApprovedChange), timeoutMs: number) {
    if (!INSTALL.test(install)) return yield* new ReproduceError({ why: "That install's name isn't one the server will use." });
    const line = yield* Effect.tryPromise({
      try: async () => {
        const path = await socketOf(join(stateDir, install));
        await checkOwnership(path);
        return await ask(path, request, timeoutMs);
      },
      catch: (error) => new ReproduceError({ why: error instanceof Error ? error.message : "Couldn't reach up." }),
    });
    const answer = yield* decodeAnswer(line).pipe(Effect.mapError(() => new ReproduceError({ why: "up's answer wasn't one the server understands." })));
    if (!answer.ok) return yield* new ReproduceError({ why: answer.error });
    return answer;
  });

  const unexpected = new ReproduceError({ why: "up's answer wasn't one the server understands." });
  return UpSocket.of({
    start: (install, request) => send(install, request, START_MS).pipe(Effect.flatMap((answer) => ("id" in answer ? Effect.succeed(answer) : Effect.fail(unexpected)))),
    exec: (install, request) =>
      send(install, request, (request.timeoutSec + 60) * 1000).pipe(Effect.flatMap((answer) => ("exitCode" in answer ? Effect.succeed(answer) : Effect.fail(unexpected)))),
    stop: (install, id) => send(install, { op: "stop", id }, QUICK_MS).pipe(Effect.asVoid),
    status: (install, id) =>
      send(install, { op: "status", id }, QUICK_MS).pipe(
        Effect.flatMap((answer) => ("running" in answer ? Effect.succeed(answer.running ? null : answer.reason) : Effect.fail(unexpected))),
      ),
    describe: (install) => send(install, { op: "describe" }, QUICK_MS).pipe(Effect.flatMap((answer) => ("fields" in answer ? Effect.succeed(answer) : Effect.fail(unexpected)))),
    // Applying now waits for the write; `up` drains afterwards on its own.
    apply: (install, change) => send(install, { op: "apply", ...change }, QUICK_MS).pipe(Effect.flatMap((answer) => ("accepted" in answer ? Effect.succeed({ when: answer.when }) : Effect.fail(unexpected)))),
  });
});

export const layer = Layer.effect(UpSocket, make);
