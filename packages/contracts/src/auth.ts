import * as Schema from "effect/Schema";

// What a session may do. Reading history and runners is separate from managing who has access,
// from running agent turns, and from starting a container the agent can run commands in.
export const AuthScope = Schema.Literals(["history:read", "runners:read", "access:write", "threads:operate", "threads:reproduce"]);
export type AuthScope = typeof AuthScope.Type;

export const ALL_SCOPES: ReadonlyArray<AuthScope> = ["history:read", "runners:read", "access:write", "threads:operate", "threads:reproduce"];
// What an outside agent and a Connect session get: everything it can read, nothing that changes
// access or spends the environment's Claude subscription.
export const MCP_SCOPES: ReadonlyArray<AuthScope> = ["history:read", "runners:read"];

// `client` sessions open the RPC socket. `mcp` sessions only reach `/mcp`, so a token pasted
// into an agent's config can't be used as an app login.
export const SessionAudience = Schema.Literals(["client", "mcp"]);
export type SessionAudience = typeof SessionAudience.Type;

export class AuthorizationError extends Schema.TaggedError<AuthorizationError>()("AuthorizationError", {
  requiredScope: AuthScope,
}) {
  override get message() {
    return `This session is missing the ${this.requiredScope} scope.`;
  }
}

export const PairRequest = Schema.Struct({
  code: Schema.String.check(Schema.isMaxLength(128)),
  label: Schema.String.check(Schema.isMaxLength(80)),
});

export const PairResponse = Schema.Struct({
  environmentId: Schema.String,
  token: Schema.String,
  scopes: Schema.Array(AuthScope),
});
export type PairResponse = typeof PairResponse.Type;

export const WsTicketResponse = Schema.Struct({ ticket: Schema.String, expiresAt: Schema.String });

// A session as the access list shows it. Never carries the token, which only the pairing
// response returns.
export const SessionSummary = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  audience: SessionAudience,
  scopes: Schema.Array(AuthScope),
  createdAt: Schema.String,
  lastSeenAt: Schema.NullOr(Schema.String),
  current: Schema.Boolean,
});
export type SessionSummary = typeof SessionSummary.Type;

export const PairingCode = Schema.Struct({ code: Schema.String, scopes: Schema.Array(AuthScope), expiresAt: Schema.String });
export type PairingCode = typeof PairingCode.Type;
