import { DESCRIPTOR_PATH, EnvironmentDescriptor, PairResponse, PROTOCOL_VERSION, WsTicketResponse } from "@runnerbox/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export class ConnectionError extends Schema.TaggedError<ConnectionError>()("ConnectionError", {
  reason: Schema.Literals(["unreachable", "unauthorized", "wrong_environment", "incompatible", "pairing_rejected", "tunnel_failed"]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message() {
    switch (this.reason) {
      case "unreachable":
        return "The server didn't answer.";
      case "unauthorized":
        return "The server no longer accepts this pairing. Pair again.";
      case "wrong_environment":
        return "A different runnerbox server answers at this address.";
      case "incompatible":
        return "This server speaks a different protocol version.";
      case "pairing_rejected":
        return "That pairing code is wrong, used or expired.";
      case "tunnel_failed":
        return "The SSH forward couldn't be opened.";
    }
  }
}

const request = (url: string, init: RequestInit, failure: { status: number; reason: ConnectionError["reason"] } | null = null) =>
  Effect.tryPromise({
    try: () => fetch(url, { ...init, cache: "no-store" }),
    catch: (cause) => new ConnectionError({ reason: "unreachable", cause }),
  }).pipe(
    Effect.flatMap((response) =>
      failure && response.status === failure.status
        ? Effect.fail(new ConnectionError({ reason: failure.reason }))
        : response.ok
          ? Effect.tryPromise({ try: () => response.json(), catch: (cause) => new ConnectionError({ reason: "unreachable", cause }) })
          : Effect.fail(new ConnectionError({ reason: "unreachable", cause: new Error(`HTTP ${response.status}`) })),
    ),
  );

const decode = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S) =>
  Effect.flatMap((body: unknown) =>
    Schema.decodeUnknownEffect(schema)(body).pipe(Effect.mapError((cause) => new ConnectionError({ reason: "incompatible", cause }))),
  );

export const fetchDescriptor = (baseUrl: string) =>
  request(new URL(DESCRIPTOR_PATH, baseUrl).href, {}).pipe(
    decode(EnvironmentDescriptor),
    Effect.filterOrFail(
      (descriptor) => descriptor.protocolVersion === PROTOCOL_VERSION,
      () => new ConnectionError({ reason: "incompatible" }),
    ),
  );

export const pairWithCode = (baseUrl: string, code: string, label: string) =>
  request(
    new URL("/api/auth/pair", baseUrl).href,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, label }) },
    { status: 401, reason: "pairing_rejected" },
  ).pipe(decode(PairResponse));

export const issueTicket = (baseUrl: string, token: string) =>
  request(
    new URL("/api/auth/ws-ticket", baseUrl).href,
    { method: "POST", headers: { authorization: `Bearer ${token}` } },
    { status: 401, reason: "unauthorized" },
  ).pipe(decode(WsTicketResponse));
