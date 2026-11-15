import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { type ChildMessage, SUPERVISED_ENV, SUPERVISOR_PROTOCOL } from "./supervisor/protocol.ts";

// What the supervisor said in answer to an update, or that it didn't answer.
export class UpdateRefused extends Data.TaggedError("UpdateRefused")<{ readonly reason: string }> {}

const ChildContext = Schema.Union([
  Schema.Struct({ protocol: Schema.Int, file: Schema.String, role: Schema.Literal("active") }),
  Schema.Struct({ protocol: Schema.Int, file: Schema.String, role: Schema.Literal("trial"), updateId: Schema.String }),
]);
export type ChildContext = typeof ChildContext.Type;

const SupervisorMessage = Schema.Union([
  Schema.Struct({ type: Schema.Literal("update-accepted"), id: Schema.String }),
  Schema.Struct({ type: Schema.Literal("update-refused"), reason: Schema.String }),
]);
const decodeMessage = Schema.decodeUnknownOption(SupervisorMessage);
const decodeContext = Schema.decodeUnknownOption(Schema.fromJsonString(ChildContext));

// The supervisor's preflight can take up to a minute; past this, it isn't going to answer.
const ANSWER_TIMEOUT = Duration.minutes(2);

// This server's line to the supervisor `runnerbox serve` started it under, if it was. Null
// `context` means it wasn't, and can't update itself.
export class Supervision extends Context.Service<
  Supervision,
  {
    readonly context: ChildContext | null;
    // Every listener is bound: a server on trial is now put in place.
    readonly ready: (version: string) => Effect.Effect<void>;
    // Asks to move to a checked download. Succeeds with the update's ID once the supervisor has
    // recorded it, after which it stops this server.
    readonly requestUpdate: (request: Omit<Extract<ChildMessage, { type: "update" }>, "type">) => Effect.Effect<string, UpdateRefused>;
  }
>()("runnerbox/server/update/Supervision") {}

const send = (message: ChildMessage) =>
  Effect.callback<void, UpdateRefused>((resume) => {
    if (!process.send || !process.connected) return resume(Effect.fail(new UpdateRefused({ reason: "The supervisor isn't there to ask." })));
    process.send(message, undefined, {}, (error) => resume(error ? Effect.fail(new UpdateRefused({ reason: "The supervisor couldn't be asked." })) : Effect.void));
  });

// The supervisor's next answer to an update.
const answer = Effect.callback<string, UpdateRefused>((resume) => {
  const onMessage = (raw: unknown) => {
    const message = decodeMessage(raw);
    if (message._tag === "None") return;
    resume(message.value.type === "update-accepted" ? Effect.succeed(message.value.id) : Effect.fail(new UpdateRefused({ reason: message.value.reason })));
  };
  const onDisconnect = () => resume(Effect.fail(new UpdateRefused({ reason: "The supervisor went away." })));
  process.on("message", onMessage);
  process.once("disconnect", onDisconnect);
  return Effect.sync(() => {
    process.off("message", onMessage);
    process.off("disconnect", onDisconnect);
  });
});

export const layer = Layer.sync(Supervision, () => {
  const decoded = decodeContext(process.env[SUPERVISED_ENV] ?? "");
  // A supervisor speaking another protocol might misread what this server sends.
  const context = decoded._tag === "Some" && decoded.value.protocol === SUPERVISOR_PROTOCOL ? decoded.value : null;
  return Supervision.of({
    context,
    ready: (version) => (context === null ? Effect.void : send({ type: "ready", version }).pipe(Effect.ignore)),
    requestUpdate: (request) =>
      context === null
        ? Effect.fail(new UpdateRefused({ reason: "This server wasn't started by runnerbox serve." }))
        : Effect.gen(function* () {
            // Listening before sending, so a quick answer isn't missed.
            const waiting = yield* Effect.forkChild(answer);
            yield* send({ type: "update", ...request });
            return yield* Fiber.join(waiting);
          }).pipe(Effect.timeoutOrElse({ duration: ANSWER_TIMEOUT, orElse: () => Effect.fail(new UpdateRefused({ reason: "The supervisor didn't answer." })) })),
  });
});

// For tests: a supervisor that answers as `answer` does.
export const layerTest = (context: ChildContext | null, answerWith: (request: Omit<Extract<ChildMessage, { type: "update" }>, "type">) => Effect.Effect<string, UpdateRefused>) =>
  Layer.succeed(Supervision, Supervision.of({ context, ready: () => Effect.void, requestUpdate: answerWith }));
