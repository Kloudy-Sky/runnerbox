import { createServer } from "node:http";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

// Signing in to Clerk as a public OAuth client: PKCE through a loopback redirect where a browser
// can reach this machine, and the device grant where it can't, as over SSH. No client secret
// exists anywhere. Node only, since the loopback flow listens on a port.

export type OAuthEndpoints = { authorize: string; token: string; deviceAuthorization: string };
export type Tokens = { accessToken: string; refreshToken: string | null; expiresAt: number };

const SCOPE = "openid profile email offline_access";

// Clerk serves OAuth from its Frontend API host, such as clerk.example.com.
export function clerkEndpoints(frontendApi: string): OAuthEndpoints {
  const base = frontendApi.startsWith("http") ? frontendApi.replace(/\/+$/, "") : `https://${frontendApi}`;
  return { authorize: `${base}/oauth/authorize`, token: `${base}/oauth/token`, deviceAuthorization: `${base}/oauth/device_authorization` };
}

const TokenBody = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.optionalKey(Schema.String),
  expires_in: Schema.optionalKey(Schema.Number),
});
const ErrorBody = Schema.Struct({ error: Schema.String });
const DeviceBody = Schema.Struct({
  device_code: Schema.String,
  user_code: Schema.String,
  verification_uri: Schema.String,
  verification_uri_complete: Schema.optionalKey(Schema.String),
  interval: Schema.optionalKey(Schema.Number),
  expires_in: Schema.Number,
});
const decodeToken = Schema.decodeUnknownOption(TokenBody);
const decodeError = Schema.decodeUnknownOption(ErrorBody);
const decodeDevice = Schema.decodeUnknownSync(DeviceBody);

export class OAuthError extends Error {}

const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const randomString = () => base64url(crypto.getRandomValues(new Uint8Array(32)));

export async function pkcePair() {
  const verifier = randomString();
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}

async function postForm(url: string, form: Record<string, string>) {
  // A token endpoint that redirects is misconfigured or hostile, so the redirect isn't followed.
  const response = await fetch(url, { method: "POST", body: new URLSearchParams(form), redirect: "manual", headers: { accept: "application/json" } });
  const body: unknown = await response.json().catch(() => ({}));
  return { ok: response.ok, body };
}

const toTokens = (body: unknown, now: number): Tokens => {
  const token = decodeToken(body);
  if (Option.isNone(token)) throw new OAuthError(Option.match(decodeError(body), { onNone: () => "Sign-in failed.", onSome: (error) => `Sign-in failed: ${error.error}` }));
  return { accessToken: token.value.access_token, refreshToken: token.value.refresh_token ?? null, expiresAt: now + (token.value.expires_in ?? 3600) * 1000 };
};

// Opens the authorize page in a browser and waits for its redirect to a port on 127.0.0.1 here.
// `state` ties the redirect to this attempt, so another page can't hand us its code.
export async function loopbackAuthorize(input: { endpoints: OAuthEndpoints; clientId: string; openBrowser: (url: string) => void; timeoutMs?: number }) {
  const { verifier, challenge } = await pkcePair();
  const state = randomString();
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || !address) throw new OAuthError("Couldn't listen for the sign-in redirect.");
  const redirectUri = `http://127.0.0.1:${address.port}/callback`;
  try {
    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new OAuthError("Sign-in timed out.")), input.timeoutMs ?? 5 * 60_000);
      server.on("request", (request, response) => {
        const url = new URL(request.url ?? "/", redirectUri);
        if (url.pathname !== "/callback") return void response.writeHead(404).end();
        const ok = url.searchParams.get("state") === state && url.searchParams.get("code");
        response.writeHead(ok ? 200 : 400, { "content-type": "text/plain" }).end(ok ? "Signed in. You can close this tab." : "Sign-in failed. Try again from the app.");
        clearTimeout(timer);
        ok ? resolve(url.searchParams.get("code")!) : reject(new OAuthError(url.searchParams.get("error") ?? "The sign-in redirect didn't match this attempt."));
      });
      const authorize = new URL(input.endpoints.authorize);
      for (const [key, value] of Object.entries({ response_type: "code", client_id: input.clientId, redirect_uri: redirectUri, scope: SCOPE, state, code_challenge: challenge, code_challenge_method: "S256" })) {
        authorize.searchParams.set(key, value);
      }
      input.openBrowser(authorize.href);
    });
    const { body } = await postForm(input.endpoints.token, { grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: input.clientId, code_verifier: verifier });
    return toTokens(body, Date.now());
  } finally {
    server.close();
  }
}

// The device grant: shows a short code to approve on Clerk's page from any browser, and polls.
export async function deviceAuthorize(input: {
  endpoints: OAuthEndpoints;
  clientId: string;
  onCode: (prompt: { userCode: string; verificationUri: string }) => void;
  sleep?: (ms: number) => Promise<void>;
}) {
  const sleep = input.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const started = await postForm(input.endpoints.deviceAuthorization, { client_id: input.clientId, scope: SCOPE });
  if (!started.ok) throw new OAuthError("This relay's sign-in doesn't allow the device grant.");
  const device = decodeDevice(started.body);
  input.onCode({ userCode: device.user_code, verificationUri: device.verification_uri_complete ?? device.verification_uri });
  let interval = (device.interval ?? 5) * 1000;
  const deadline = Date.now() + device.expires_in * 1000;
  while (Date.now() < deadline) {
    await sleep(interval);
    const { ok, body } = await postForm(input.endpoints.token, { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: device.device_code, client_id: input.clientId });
    if (ok) return toTokens(body, Date.now());
    const error = Option.getOrUndefined(decodeError(body))?.error;
    if (error === "slow_down") interval += 5000;
    else if (error !== "authorization_pending") throw new OAuthError(`Sign-in failed: ${error ?? "unknown error"}`);
  }
  throw new OAuthError("The code expired before it was approved.");
}

export async function refreshTokens(input: { endpoints: OAuthEndpoints; clientId: string; refreshToken: string }) {
  const { body } = await postForm(input.endpoints.token, { grant_type: "refresh_token", refresh_token: input.refreshToken, client_id: input.clientId });
  return toTokens(body, Date.now());
}
