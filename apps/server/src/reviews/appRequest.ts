import { githubHeaders } from "runnerbox/src/github/github-client.ts";

export type AppReply =
  | { readonly kind: "ok"; readonly body: unknown }
  // GitHub didn't take the token: a wrong App ID or key, or an App that was deleted.
  | { readonly kind: "refused" }
  | { readonly kind: "error"; readonly message: string };

const TIMEOUT_MS = 15_000;

// One request as the App or as one of its installations, to the one API host. A redirect is never
// followed, so a token can't be sent anywhere else. Callers build paths only from numbers GitHub gave.
export async function appRequest(apiBase: string, method: "GET" | "POST", path: string, token: string, body?: object): Promise<AppReply> {
  try {
    const response = await fetch(`${apiBase}/${path}`, {
      method,
      headers: { ...githubHeaders(token), ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.ok) return { kind: "ok", body: await response.json().catch(() => null) };
    if (response.status === 401 || response.status === 404) return { kind: "refused" };
    return { kind: "error", message: `GitHub answered ${response.status}` };
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.name : "the request failed" };
  }
}
