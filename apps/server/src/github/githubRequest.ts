import { githubHeaders } from "runnerbox/src/github/github-client.ts";

export type GitHubReply =
  | { readonly kind: "ok"; readonly body: unknown }
  // GitHub didn't take the token, or says there's nothing there for it.
  | { readonly kind: "refused" }
  // `status` is GitHub's, or null when no answer came.
  | { readonly kind: "error"; readonly message: string; readonly status: number | null };

const TIMEOUT_MS = 15_000;

// One request with the signed-in user's token, to the one API host. A redirect is never followed,
// so the token can't be sent anywhere else. Callers build paths only from checked names and numbers GitHub gave.
export async function githubRequest(apiBase: string, method: "GET" | "POST", path: string, token: string, body?: object): Promise<GitHubReply> {
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
    return { kind: "error", message: `GitHub answered ${response.status}`, status: response.status };
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.name : "the request failed", status: null };
  }
}
