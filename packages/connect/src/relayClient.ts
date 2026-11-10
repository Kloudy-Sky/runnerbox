import { ConnectResponse, LinkChallengeResponse, LinkedEnvironment, LinkResponse, RelayConfig, StatusResponse } from "@runnerbox/contracts";
import * as Schema from "effect/Schema";

// Calls a Runnerbox Connect relay. Every call that acts for a user carries their Clerk token;
// unlinking is signed by the environment's own key instead, so a headless machine can leave
// without signing in again.

export class RelayError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(`The relay refused the request: ${code} (${status}).`);
    this.status = status;
    this.code = code;
  }
}

async function call<S extends Schema.Top & { readonly DecodingServices: never }>(
  relayUrl: string,
  path: string,
  schema: S,
  init: { method?: string; token?: string; body?: unknown } = {},
): Promise<S["Type"]> {
  const response = await fetch(new URL(path, relayUrl), {
    method: init.method ?? "GET",
    redirect: "manual",
    headers: {
      accept: "application/json",
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : "request_failed";
    throw new RelayError(response.status, code);
  }
  return Schema.decodeUnknownSync(schema)(body);
}

export const relayClient = (relayUrl: string) => ({
  config: () => call(relayUrl, "/v1/config", RelayConfig),
  linkChallenge: (token: string) => call(relayUrl, "/v1/link/challenge", LinkChallengeResponse, { method: "POST", token }),
  link: (token: string, proof: string) => call(relayUrl, "/v1/link", LinkResponse, { method: "POST", token, body: { proof } }),
  unlink: (proof: string) => call(relayUrl, "/v1/unlink", Schema.Struct({ ok: Schema.Boolean }), { method: "POST", body: { proof } }),
  environments: (token: string) => call(relayUrl, "/v1/environments", Schema.Array(LinkedEnvironment), { token }),
  connect: (token: string, environmentId: string, clientProofKeyThumbprint: string) =>
    call(relayUrl, `/v1/environments/${encodeURIComponent(environmentId)}/connect`, ConnectResponse, { method: "POST", token, body: { clientProofKeyThumbprint } }),
  status: (token: string, environmentId: string) => call(relayUrl, `/v1/environments/${encodeURIComponent(environmentId)}/status`, StatusResponse, { token }),
});

export type RelayClient = ReturnType<typeof relayClient>;
