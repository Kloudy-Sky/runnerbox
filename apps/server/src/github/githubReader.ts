import { githubHeaders } from "runnerbox/src/github/github-client.ts";

// How much of the token's hourly budget is left, from the headers on every response, a 304 included.
export type Budget = { remaining: number; limit: number; resetAt: number };

export type Reply =
  | { kind: "ok"; body: unknown; budget: Budget | null }
  // GitHub said to wait: a secondary limit, `Retry-After`, or the hourly budget used up.
  | { kind: "limited"; untilMs: number; budget: Budget | null }
  | { kind: "refused"; status: number }
  // Refused for this one repo, such as an org whose SSO the token isn't authorized for.
  | { kind: "forbidden" }
  | { kind: "missing" }
  | { kind: "error"; message: string };

const TIMEOUT_MS = 15_000;

const budgetOf = (headers: Headers): Budget | null => {
  const remaining = Number(headers.get("x-ratelimit-remaining"));
  const limit = Number(headers.get("x-ratelimit-limit"));
  const reset = Number(headers.get("x-ratelimit-reset"));
  return headers.has("x-ratelimit-remaining") && limit > 0 ? { remaining, limit, resetAt: reset * 1000 } : null;
};

// GitHub asks for at least a minute's wait after a secondary limit that names no time.
const SECONDARY_WAIT_MS = 60_000;

// GET requests to one fixed API host, each sent with the last ETag for its path, so a reply that
// hasn't changed is a 304, which GitHub doesn't count against the budget. A redirect is never
// followed, so the token can't be sent anywhere else. Callers build paths only from checked names.
// `prune` drops the cached replies for paths not asked for since the last prune, so the cache holds
// one look's worth and doesn't grow with every run a repo ever had.
export function createGitHubReader(apiBase: string, now: () => number = Date.now) {
  const cache = new Map<string, { etag: string; body: unknown }>();
  const asked = new Set<string>();

  const prune = () => {
    for (const path of cache.keys()) if (!asked.has(path)) cache.delete(path);
    asked.clear();
  };

  async function get(path: string, token: string): Promise<Reply> {
    asked.add(path);
    const cached = cache.get(path);
    let response: Response;
    try {
      response = await fetch(`${apiBase}/${path}`, {
        headers: { ...githubHeaders(token), ...(cached ? { "If-None-Match": cached.etag } : {}) },
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      return { kind: "error", message: error instanceof Error ? error.name : "the request failed" };
    }
    const budget = budgetOf(response.headers);
    if (response.status === 304 && cached) return { kind: "ok", body: cached.body, budget };
    if (response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const etag = response.headers.get("etag");
      if (etag) cache.set(path, { etag, body });
      return { kind: "ok", body, budget };
    }
    const retryAfter = Number(response.headers.get("retry-after"));
    if ((response.status === 403 || response.status === 429) && retryAfter > 0) return { kind: "limited", untilMs: now() + retryAfter * 1000, budget };
    if ((response.status === 403 || response.status === 429) && budget?.remaining === 0) return { kind: "limited", untilMs: budget.resetAt, budget };
    if (response.status === 429) return { kind: "limited", untilMs: now() + SECONDARY_WAIT_MS, budget };
    if (response.status === 403) {
      const text = await response.text().catch(() => "");
      return /secondary rate limit/i.test(text) ? { kind: "limited", untilMs: now() + SECONDARY_WAIT_MS, budget } : { kind: "forbidden" };
    }
    if (response.status === 401) return { kind: "refused", status: response.status };
    if (response.status === 404) return { kind: "missing" };
    if (response.status >= 300 && response.status < 400) return { kind: "error", message: `GitHub answered with a redirect (${response.status}), which isn't followed` };
    return { kind: "error", message: `GitHub answered ${response.status}` };
  }

  return { get, prune };
}

export type GitHubReader = ReturnType<typeof createGitHubReader>;
