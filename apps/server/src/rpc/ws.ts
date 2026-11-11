import { RunnerboxRpcGroup } from "@runnerbox/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as RpcServer from "effect/rpc/RpcServer";
import * as AuthStore from "../auth/AuthStore.ts";
import * as Handlers from "./handlers.ts";
import * as RpcAuthorization from "./RpcAuthorization.ts";

// The RPC socket. Each connection redeems a ticket, then gets its own server whose middleware
// checks every call against that session's scopes.
export const layer = (entry: AuthStore.Entry) => HttpRouter.add(
  "GET",
  "/ws",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const store = yield* AuthStore.AuthStore;
    const ticket = Option.getOrUndefined(HttpServerRequest.toURL(request))?.searchParams.get("ticket") ?? "";
    const session = yield* store.redeemTicket(ticket, entry);
    if (!session) return HttpServerResponse.jsonUnsafe({ error: "invalid_ticket" }, { status: 401 });
    const { protocol, httpEffect } = yield* RpcServer.makeProtocolWithHttpEffectWebsocket;
    yield* RpcServer.make(RunnerboxRpcGroup, { disableFatalDefects: true }).pipe(
      Effect.provideService(RpcServer.Protocol, protocol),
      Effect.provide(Layer.merge(Handlers.layer(session), RpcAuthorization.layer(session.scopes))),
      Effect.forkScoped,
    );
    return yield* httpEffect;
  }).pipe(Effect.provide(RpcSerialization.layerJson)),
);
