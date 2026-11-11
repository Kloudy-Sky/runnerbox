import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpProtocol, McpServer } from "effect/ai";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import packageJson from "../../package.json" with { type: "json" };
import * as AuthStore from "../auth/AuthStore.ts";
import { bearerToken } from "../http/bearer.ts";
import * as Handlers from "./handlers.ts";
import { RunnerboxToolkit } from "./tools.ts";

// `/mcp` takes only tokens from `runnerbox mcp-token`, never an app's session: a token kept
// in an agent's config can read, and can't open the RPC socket or manage access.
const layerAuth = HttpRouter.middleware(
  Effect.gen(function* () {
    const store = yield* AuthStore.AuthStore;
    return (httpEffect) =>
      Effect.gen(function* () {
        const token = bearerToken(yield* HttpServerRequest.HttpServerRequest);
        const session = token === undefined ? undefined : yield* store.authenticate(token, "mcp").pipe(Effect.orElseSucceed(() => undefined));
        if (!session) {
          return HttpServerResponse.jsonUnsafe(
            { error: "invalid_credential", message: "Use a token from `runnerbox mcp-token` as a Bearer token." },
            { status: 401, headers: { "cache-control": "no-store", "www-authenticate": "Bearer" } },
          );
        }
        return yield* httpEffect;
      });
  }),
).layer;

const layerTransport = McpServer.layerHttp({
  name: "runnerbox",
  version: packageJson.version,
  path: "/mcp",
  protocols: [McpProtocol.v2025_06_18],
  instructions: "Read-only CI history and runner state for one machine running runnerbox. Start with ci_inbox.",
}).pipe(Layer.provide(layerAuth));

export const layer = McpServer.toolkit(RunnerboxToolkit).pipe(Layer.provide(Handlers.layer), Layer.provideMerge(layerTransport));
