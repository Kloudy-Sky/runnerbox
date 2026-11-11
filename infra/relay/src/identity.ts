import { createRemoteJWKSet, jwtVerify } from "jose";

// Who a Clerk token belongs to. Only Clerk-signed JWTs issued to this relay's own OAuth clients,
// the CLI and the desktop app, count: a token Clerk issued to any other app on the same Clerk
// instance is refused. Clerk's opaque OAuth tokens can't be tied to a client without a secret,
// which public clients don't have, so those are refused too; the OAuth apps must issue JWT access
// tokens (see docs/connect-setup.md). Returns null for anything else.
export interface IdentityVerifier {
  verify(token: string): Promise<{ userId: string } | null>;
}

export function clerkIdentity(config: { frontendApi: string; clientIds: ReadonlyArray<string> }): IdentityVerifier {
  const base = config.frontendApi.startsWith("http") ? config.frontendApi.replace(/\/+$/, "") : `https://${config.frontendApi}`;
  const jwks = createRemoteJWKSet(new URL(`${base}/.well-known/jwks.json`));
  const clients = new Set(config.clientIds);
  return {
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, jwks, { issuer: base, algorithms: ["RS256"] });
        const client = typeof payload.client_id === "string" ? payload.client_id : payload.azp;
        if (typeof payload.sub !== "string" || !payload.sub || typeof client !== "string" || !clients.has(client)) return null;
        return { userId: payload.sub };
      } catch {
        return null;
      }
    },
  };
}
