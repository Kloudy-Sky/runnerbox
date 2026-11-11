import { DPOP_HEADER } from "@runnerbox/contracts";
import { verifyProof } from "@runnerbox/connect/dpop";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as AuthStore from "../auth/AuthStore.ts";

// The thumbprint of the key that signed this request's DPoP proof, undefined when it carries
// none, or `invalid` when it carries one that fails: a bad signature, the wrong request, too old,
// or already used.
export const dpopThumbprint = Effect.fnUntraced(function* (request: HttpServerRequest.HttpServerRequest) {
  const proof = request.headers[DPOP_HEADER];
  if (proof === undefined) return undefined;
  const store = yield* AuthStore.AuthStore;
  const path = Option.getOrUndefined(HttpServerRequest.toURL(request))?.pathname ?? "";
  const now = yield* Clock.currentTimeMillis;
  const verified = yield* Effect.tryPromise({ try: () => verifyProof(proof, { method: request.method, path, now }), catch: () => "invalid" }).pipe(Effect.option);
  if (Option.isNone(verified)) return "invalid" as const;
  const fresh = yield* store.consumeOnce(`dpop:${verified.value.thumbprint}:${verified.value.jti}`, verified.value.expiresAt).pipe(Effect.orElseSucceed(() => false));
  return fresh ? verified.value.thumbprint : ("invalid" as const);
});
