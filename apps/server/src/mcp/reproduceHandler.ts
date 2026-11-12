import * as Effect from "effect/Effect";
import * as Threads from "../threads/Threads.ts";
import { McpSession } from "./McpSession.ts";
import { ReproduceToolkit } from "./reproduceTool.ts";

// `repro_exec` runs for the session whose token made the call: the reproduce is the one that
// session's turn is bound to, never one named in the arguments.
export const layer = ReproduceToolkit.toLayer(
  Effect.gen(function* () {
    const threads = yield* Threads.Threads;
    return {
      repro_exec: ({ command, timeoutSec }) =>
        Effect.serviceOption(McpSession).pipe(
          Effect.flatMap((session) => (session._tag === "Some" ? Effect.succeed(session.value) : Effect.fail({ message: "This token can't run commands." }))),
          Effect.flatMap((session) => threads.reproduceExec(session.id, command, timeoutSec).pipe(Effect.mapError((error) => ({ message: error.why })))),
          Effect.map(({ exitCode, timedOut, output, truncated, commandsLeft }) => ({ exitCode, timedOut, output, truncated, commandsLeft })),
        ),
    };
  }),
);
