import { AuthorizationError, type AuthScope, type RpcMethod, RPC_SCOPES, RpcScopeAuthorization } from "@runnerbox/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

// A socket being open doesn't mean every method on it is allowed. Each call is checked against
// the scopes its session holds before its handler runs.
export const layer = (scopes: ReadonlyArray<AuthScope>) =>
  Layer.succeed(RpcScopeAuthorization)((effect, { rpc }) => {
    const missing = RPC_SCOPES[rpc._tag as RpcMethod].find((scope) => !scopes.includes(scope));
    return missing === undefined ? effect : Effect.fail(new AuthorizationError({ requiredScope: missing }));
  });
