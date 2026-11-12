import { lstat } from "node:fs/promises";
import { connect } from "node:net";
import { dirname, join } from "node:path";
import { ReproduceError } from "@runnerbox/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { ReproduceRequest } from "runnerbox/src/reproduce/protocol.ts";
import { socketPath } from "runnerbox/src/reproduce/socket.ts";
import * as ServerPaths from "../config/ServerPaths.ts";

// `up`'s answers, checked like any other input, though only this user can write the socket.
const Answer = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), id: Schema.String, image: Schema.String, imageFallback: Schema.Boolean }),
  Schema.Struct({ ok: Schema.Literal(true), exitCode: Schema.NullOr(Schema.Int), output: Schema.String, truncated: Schema.Boolean, timedOut: Schema.Boolean, commandsLeft: Schema.Int }),
  Schema.Struct({ ok: Schema.Literal(true), stopped: Schema.Literal(true) }),
  Schema.Struct({ ok: Schema.Literal(true), running: Schema.Literal(true) }),
  Schema.Struct({ ok: Schema.Literal(true), running: Schema.Literal(false), reason: Schema.String }),
  Schema.Struct({ ok: Schema.Literal(false), error: Schema.String }),
]);
type Answer = typeof Answer.Type;
const decodeAnswer = Schema.decodeUnknownEffect(Schema.fromJsonString(Answer));

export type Started = Extract<Answer, { id: string }>;
export type Executed = Extract<Answer, { exitCode: number | null }>;

// An install's name came from its own directory, but it still only names one under the state directory.
const INSTALL = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_ANSWER_BYTES = 64 * 1024;

// Talks to one install's `up` over `<state>/<install>/reproduce/up.sock`: one JSON line out, one
// back. Before connecting it checks that the directory and the socket are this user's alone, so
// another user can't stand in for `up`.
export class UpSocket extends Context.Service<
  UpSocket,
  {
    readonly start: (install: string, request: Extract<ReproduceRequest, { op: "start" }>) => Effect.Effect<Started, ReproduceError>;
    readonly exec: (install: string, request: Extract<ReproduceRequest, { op: "exec" }>) => Effect.Effect<Executed, ReproduceError>;
    readonly stop: (install: string, id: string) => Effect.Effect<void, ReproduceError>;
    // Null while it runs; why it ended once `up` removed it.
    readonly status: (install: string, id: string) => Effect.Effect<string | null, ReproduceError>;
  }
>()("runnerbox/server/reproduce/UpSocket") {}

const uid = () => process.getuid?.() ?? -1;

export async function checkOwnership(path: string) {
  for (const [what, entry, kind] of [["Its directory", dirname(path), "directory"], ["The socket", path, "socket"]] as const) {
    const found = await lstat(entry).catch(() => null);
    if (!found) throw new Error("That install's up has no reproduce socket. Add a reproduce block to its config and restart it.");
    if (kind === "directory" ? !found.isDirectory() : !found.isSocket()) throw new Error(`${what} isn't a ${kind}, so the server won't use it.`);
    if (found.uid !== uid()) throw new Error(`${what} belongs to another user, so the server won't use it.`);
    if ((found.mode & 0o077) !== 0) throw new Error(`${what} is open to other users, so the server won't use it.`);
  }
}

function ask(path: string, request: ReproduceRequest, timeoutMs: number) {
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

  const send = Effect.fn("UpSocket.send")(function* (install: string, request: ReproduceRequest, timeoutMs: number) {
    if (!INSTALL.test(install)) return yield* new ReproduceError({ why: "That install's name isn't one the server will use." });
    const path = socketPath(join(stateDir, install));
    const line = yield* Effect.tryPromise({
      try: async () => {
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
  });
});

export const layer = Layer.effect(UpSocket, make);
