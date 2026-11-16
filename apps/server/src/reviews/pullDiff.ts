import { githubHeaders } from "runnerbox/src/github/github-client.ts";

export type DiffReply = { readonly kind: "ok"; readonly diff: string } | { readonly kind: "too_large" } | { readonly kind: "error"; readonly message: string };

const TIMEOUT_MS = 30_000;
// Far past any diff that could be reviewed, so a reply is never read without end.
const MAX_REPLY_CHARS = 8_000_000;

// What a pull request changes, as GitHub's diff between its base and its head: the changes on the
// head since the two last shared a commit. Both are commit IDs, so the diff is of exactly the commit
// being reviewed, whatever is pushed meanwhile. A redirect is never followed.
export async function pullDiff(apiBase: string, repo: string, baseSha: string, headSha: string, token: string): Promise<DiffReply> {
  try {
    const response = await fetch(`${apiBase}/repos/${repo}/compare/${baseSha}...${headSha}`, {
      headers: { ...githubHeaders(token), Accept: "application/vnd.github.diff" },
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // GitHub answers 406 when a diff is too big for it to make.
    if (response.status === 406) return { kind: "too_large" };
    if (!response.ok) return { kind: "error", message: `GitHub answered ${response.status}` };
    const diff = await response.text();
    return diff.length > MAX_REPLY_CHARS ? { kind: "too_large" } : { kind: "ok", diff };
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.name : "the request failed" };
  }
}
