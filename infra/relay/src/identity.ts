import { createRemoteJWKSet, jwtVerify } from "jose";

// Who a Clerk token belongs to. Desktop sign-in and the CLI both use Clerk OAuth, whose access
// tokens may be JWTs or opaque, so a token that isn't a valid Clerk JWT is checked against Clerk's
// userinfo endpoint instead. Returns null for anything Clerk doesn't vouch for.
export interface IdentityVerifier {
  verify(token: string): Promise<{ userId: string } | null>;
}

export function clerkIdentity(config: { frontendApi: string; fetch?: typeof fetch }): IdentityVerifier {
  const base = config.frontendApi.startsWith("http") ? config.frontendApi.replace(/\/+$/, "") : `https://${config.frontendApi}`;
  const jwks = createRemoteJWKSet(new URL(`${base}/.well-known/jwks.json`));
  const doFetch = config.fetch ?? fetch;
  return {
    async verify(token) {
      if (token.split(".").length === 3) {
        try {
          const { payload } = await jwtVerify(token, jwks, { issuer: base, algorithms: ["RS256"] });
          if (typeof payload.sub === "string" && payload.sub) return { userId: payload.sub };
        } catch {}
      }
      const response = await doFetch(`${base}/oauth/userinfo`, { headers: { authorization: `Bearer ${token}` }, redirect: "manual" });
      if (!response.ok) return null;
      const body: unknown = await response.json().catch(() => null);
      return typeof body === "object" && body !== null && "sub" in body && typeof body.sub === "string" && body.sub ? { userId: body.sub } : null;
    },
  };
}
