import { SignedRequest } from "@runnerbox/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as CloudLink from "../cloud/CloudLink.ts";

// The relay's two requests to this environment. Each carries a proof signed by the linked relay,
// which is the only authority these accept; the environment signs its answer in turn.
const respond = (body: unknown, status = 200) => HttpServerResponse.jsonUnsafe(body, { status, headers: { "cache-control": "no-store" } });

const route = (path: `/${string}`, handle: (link: CloudLink.CloudLink["Service"], proof: string) => Effect.Effect<unknown, CloudLink.CloudLinkError | CloudLink.NotLinked | CloudLink.ConnectProofRejected | CloudLink.ConnectProofReplayed>) =>
  HttpRouter.add(
    "POST",
    path,
    Effect.gen(function* () {
      const link = yield* CloudLink.CloudLink;
      const { proof } = yield* HttpServerRequest.schemaBodyJson(SignedRequest);
      return respond(yield* handle(link, proof));
    }).pipe(
      Effect.catchTags({
        NotLinked: () => Effect.succeed(respond({ error: "not_linked" }, 404)),
        ConnectProofRejected: () => Effect.succeed(respond({ error: "proof_rejected" }, 401)),
        ConnectProofReplayed: () => Effect.succeed(respond({ error: "proof_replayed" }, 409)),
        CloudLinkError: () => Effect.succeed(respond({ error: "internal_error" }, 500)),
        SchemaError: () => Effect.succeed(respond({ error: "invalid_request" }, 400)),
        HttpServerError: () => Effect.succeed(respond({ error: "invalid_request" }, 400)),
      }),
    ),
  );

export const layer = Layer.mergeAll(
  route("/api/connect/mint", (link, proof) => link.mint(proof)),
  route("/api/connect/health", (link, proof) => link.health(proof)),
);
