import { RunnerboxRpcGroup } from "@runnerbox/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RpcClient from "effect/rpc/RpcClient";
import type { RpcClientError } from "effect/rpc/RpcClientError";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import * as Socket from "effect/socket/Socket";
import { ConnectionError, issueTicket } from "./http.ts";

export type RunnerboxClient = RpcClient.FromGroup<typeof RunnerboxRpcGroup, RpcClientError>;

const socketUrl = (baseUrl: string, ticket: string) => {
  const url = new URL("/ws", baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("ticket", ticket);
  return url.href;
};

// Opens one RPC socket. Tickets open one socket each, so this doesn't retry on its own: when
// `closed` resolves, the caller opens a new session with a new ticket.
export const openSession = Effect.fn("openSession")(function* (baseUrl: string, token: string) {
  const { ticket } = yield* issueTicket(baseUrl, token);
  const opened = yield* Deferred.make<void>();
  const closed = yield* Deferred.make<void>();
  const hooks = RpcClient.ConnectionHooks.of({
    onConnect: Deferred.succeed(opened, undefined).pipe(Effect.asVoid),
    onDisconnect: Deferred.succeed(closed, undefined).pipe(Effect.asVoid),
  });
  const protocol = RpcClient.layerProtocolSocket({ retryTransientErrors: false }).pipe(
    Layer.provide(Socket.layerWebSocket(socketUrl(baseUrl, ticket))),
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
    Layer.provide(RpcSerialization.layerJson),
    Layer.provide(Layer.succeed(RpcClient.ConnectionHooks, hooks)),
  );
  const context = yield* Layer.build(protocol);
  const client: RunnerboxClient = yield* RpcClient.make(RunnerboxRpcGroup).pipe(Effect.provideContext(context));
  yield* Deferred.await(opened).pipe(
    Effect.raceFirst(Deferred.await(closed).pipe(Effect.andThen(Effect.fail(new ConnectionError({ reason: "unreachable" }))))),
    Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => Effect.fail(new ConnectionError({ reason: "unreachable" })) }),
  );
  return { client, closed: Deferred.await(closed) };
});
