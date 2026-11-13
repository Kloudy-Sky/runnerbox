import * as Effect from "effect/Effect";
import * as Threads from "../threads/Threads.ts";
import { McpSession } from "./McpSession.ts";
import { ProposeToolkit } from "./proposeTool.ts";

// `propose_change` records for the thread whose turn token made the call, which the route already
// authenticated; any other token is refused.
export const layer = ProposeToolkit.toLayer(
  Effect.gen(function* () {
    const threads = yield* Threads.Threads;
    return {
      propose_change: (input) =>
        Effect.serviceOption(McpSession).pipe(
          Effect.flatMap((session) => (session._tag === "Some" ? Effect.succeed(session.value) : Effect.fail({ message: "This token can't propose changes." }))),
          Effect.flatMap((session) => threads.proposeChange(session.id, input).pipe(Effect.mapError((error) => ({ message: error.why })))),
        ),
    };
  }),
);
