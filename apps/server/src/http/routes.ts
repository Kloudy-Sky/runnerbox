import { DESCRIPTOR_PATH, PairRequest, SERVER_PROOF_NONCE } from "@runnerbox/contracts";
import * as Option from "effect/Option";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as AuthStore from "../auth/AuthStore.ts";
import * as EnvironmentIdentity from "../environment/EnvironmentIdentity.ts";
import { bearerToken } from "./bearer.ts";
import { dpopThumbprint } from "./dpop.ts";

const noStore = { "cache-control": "no-store" };
const fail = (status: number, error: string) => HttpServerResponse.jsonUnsafe({ error }, { status, headers: noStore });

// Public: who this is. With a client's nonce it also proves it holds the environment's key, so
// the client can check that before sending any credential.
const descriptor = HttpRouter.add(
  "GET",
  DESCRIPTOR_PATH,
  Effect.gen(function* () {
    const { descriptor, proveTo } = yield* EnvironmentIdentity.EnvironmentIdentity;
    const nonce = Option.getOrUndefined(HttpServerRequest.toURL(yield* HttpServerRequest.HttpServerRequest))?.searchParams.get("nonce");
    if (nonce === undefined || nonce === null) return HttpServerResponse.jsonUnsafe(descriptor, { headers: noStore });
    if (!SERVER_PROOF_NONCE.test(nonce)) return fail(400, "invalid_nonce");
    return HttpServerResponse.jsonUnsafe({ ...descriptor, proof: proveTo(nonce) }, { headers: noStore });
  }),
);

// Trades a one-time pairing code for a client session token. Through the tunnel, only a code
// bound to the requester's key is accepted.
const pair = (entry: AuthStore.Entry) => HttpRouter.add(
  "POST",
  "/api/auth/pair",
  Effect.gen(function* () {
    const store = yield* AuthStore.AuthStore;
    const { descriptor } = yield* EnvironmentIdentity.EnvironmentIdentity;
    const input = yield* HttpServerRequest.schemaBodyJson(PairRequest);
    // A Connect credential is bound to the client's key; the proof shows the client holds it.
    const proofKeyThumbprint = yield* dpopThumbprint(yield* HttpServerRequest.HttpServerRequest);
    if (proofKeyThumbprint === "invalid") return fail(401, "invalid_proof");
    const { token, session } = yield* store.pair({ ...input, proofKeyThumbprint, keyBoundOnly: entry === "tunnel" });
    return HttpServerResponse.jsonUnsafe(
      { environmentId: descriptor.environmentId, token, scopes: session.scopes },
      { headers: noStore },
    );
  }).pipe(
    Effect.catchTags({
      PairingRejected: () => Effect.succeed(fail(401, "pairing_rejected")),
      SchemaError: () => Effect.succeed(fail(400, "invalid_request")),
      HttpServerError: () => Effect.succeed(fail(400, "invalid_request")),
    }),
  ),
);

// A browser can't set headers on a WebSocket, so the client trades its token for a ticket that
// goes in the socket URL. It lasts seconds and opens one socket, so the token stays out of URLs.
const wsTicket = (entry: AuthStore.Entry) => HttpRouter.add(
  "POST",
  "/api/auth/ws-ticket",
  Effect.gen(function* () {
    const store = yield* AuthStore.AuthStore;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const token = bearerToken(request);
    const proofKeyThumbprint = yield* dpopThumbprint(request);
    if (proofKeyThumbprint === "invalid") return fail(401, "invalid_proof");
    const session = token === undefined ? undefined : yield* store.authenticate(token, "client", proofKeyThumbprint);
    // Through the tunnel, only sessions bought with a Connect credential work.
    if (!session || (entry === "tunnel" && session.proofKeyThumbprint === undefined)) return fail(401, "invalid_credential");
    return HttpServerResponse.jsonUnsafe(yield* store.issueTicket(session, entry), { headers: noStore });
  }),
);

// Credentials are bearer tokens, never cookies, so any origin may call these: a page in the
// user's browser has nothing it could ride on.
const cors = HttpRouter.cors({ allowedHeaders: ["authorization", "content-type", "dpop"], maxAge: 600 });

export const layer = (entry: AuthStore.Entry) => Layer.mergeAll(descriptor, pair(entry), wsTicket(entry), cors);
