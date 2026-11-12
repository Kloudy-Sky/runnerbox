import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as AuthStore from "../auth/AuthStore.ts";
import { bearerToken } from "../http/bearer.ts";
import * as Threads from "../threads/Threads.ts";
import { ReproduceToolkit } from "./reproduceTool.ts";

// `repro_exec` runs for the session whose token made the call, which the route already checked:
// the reproduce is the one that session's turn is bound to, never one named in the arguments.
export const layer = ReproduceToolkit.toLayer(
  Effect.gen(function* () {
    const auth = yield* AuthStore.AuthStore;
    const threads = yield* Threads.Threads;
    return {
      repro_exec: ({ command, timeoutSec }) =>
        Effect.gen(function* () {
          // The MCP route's request, which the transport passes through to its tools.
          const request = yield* Effect.serviceOption(HttpServerRequest.HttpServerRequest);
          const token = request._tag === "Some" ? bearerToken(request.value) : undefined;
          const session = token === undefined ? undefined : yield* auth.authenticate(token, "mcp").pipe(Effect.orElseSucceed(() => undefined));
          if (!session) return yield* Effect.fail({ message: "This token can't run commands." });
          const result = yield* threads.reproduceExec(session.id, command, timeoutSec).pipe(Effect.mapError((error) => ({ message: error.why })));
          return { exitCode: result.exitCode, timedOut: result.timedOut, output: result.output, truncated: result.truncated, commandsLeft: result.commandsLeft };
        }),
    };
  }),
);
