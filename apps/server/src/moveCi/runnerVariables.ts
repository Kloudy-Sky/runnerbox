import type { CiVariable, RunnerVariable } from "@runnerbox/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { GitHubReader } from "../github/githubReader.ts";
import { githubRequest } from "../github/githubRequest.ts";

// A repository's runner variables on GitHub, through the App's Variables permission. Reads are
// lists, so they carry ETags and an unchanged one costs nothing; a single variable that isn't set
// would answer 404 every time. Callers pass only checked repository names and variable names.

const decodeVariables = Schema.decodeUnknownOption(Schema.Struct({ total_count: Schema.Int, variables: Schema.Array(Schema.Struct({ name: Schema.String, value: Schema.String })) }));
// GitHub lists at most 30 a page.
const PER_PAGE = 30;
const MAX_PAGES = 5;
const MAX_SHOWN = 100;

// The repository's own text, shown as one plain line.
const shown = (value: string) => value.replace(/\p{Cc}+/gu, " ").trim().slice(0, MAX_SHOWN);

// `missing` is a 404 and `refused` a 401 or 403; `unread` is any other answer, or none.
type Listed =
  | { readonly kind: "listed"; readonly values: ReadonlyMap<string, string> }
  | { readonly kind: "missing" | "refused" | "unread" }
  | { readonly kind: "limited"; readonly untilMs: number };

// Every variable at `path`, by name as GitHub keeps it, in upper case.
async function list(reader: GitHubReader, path: string, token: string): Promise<Listed> {
  const values = new Map<string, string>();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const reply = await reader.get(`${path}?per_page=${PER_PAGE}&page=${page}`, token);
    if (reply.kind === "limited") return { kind: "limited", untilMs: reply.untilMs };
    if (reply.kind === "missing") return { kind: "missing" };
    if (reply.kind === "refused" || reply.kind === "forbidden") return { kind: "refused" };
    const body = reply.kind === "ok" ? decodeVariables(reply.body) : Option.none();
    if (Option.isNone(body)) return { kind: "unread" };
    for (const { name, value } of body.value.variables) values.set(name.toUpperCase(), shown(value));
    if (page * PER_PAGE >= body.value.total_count) break;
  }
  return { kind: "listed", values };
}

export type ReadVariables =
  | { readonly kind: "read"; readonly variables: ReadonlyArray<CiVariable> }
  | { readonly kind: "refused" | "unread" }
  | { readonly kind: "limited"; readonly untilMs: number };

// The repository's and its organization's value of each variable named. GitHub refuses the
// repository's to a user without access to them. Only a clean answer about the organization's
// counts, or a 404, which a repository no organization shares variables with gets: any other
// failure leaves them unknown, since a delete is safe only when the organization sets none.
export async function readVariables(reader: GitHubReader, repo: string, names: ReadonlyArray<RunnerVariable>, token: string): Promise<ReadVariables> {
  const own = await list(reader, `repos/${repo}/actions/variables`, token);
  if (own.kind === "limited") return own;
  if (own.kind !== "listed") return { kind: own.kind === "unread" ? "unread" : "refused" };
  const org = await list(reader, `repos/${repo}/actions/organization-variables`, token);
  if (org.kind === "limited") return org;
  if (org.kind !== "listed" && org.kind !== "missing") return { kind: "unread" };
  const orgValues = org.kind === "listed" ? org.values : new Map<string, string>();
  return { kind: "read", variables: names.map((name) => ({ name, value: own.values.get(name) ?? null, org: orgValues.get(name) ?? null })) };
}

export type Written = "done" | "refused" | "unreachable";

// Sets the variable to `label`, creating it when the repository has none, or deletes it for null.
// A variable already gone (404) counts as deleted; a token GitHub won't take (401) never does.
export async function writeVariable(apiBase: string, repo: string, name: RunnerVariable, label: string | null, token: string): Promise<Written> {
  const outcome = (reply: Awaited<ReturnType<typeof githubRequest>>): Written => (reply.kind === "ok" ? "done" : reply.kind === "error" && reply.status === null ? "unreachable" : "refused");
  if (label === null) {
    const deleted = await githubRequest(apiBase, "DELETE", `repos/${repo}/actions/variables/${name}`, token);
    return deleted.kind === "refused" && deleted.status === 404 ? "done" : outcome(deleted);
  }
  const updated = await githubRequest(apiBase, "PATCH", `repos/${repo}/actions/variables/${name}`, token, { name, value: label });
  if (updated.kind !== "refused" || updated.status !== 404) return outcome(updated);
  return outcome(await githubRequest(apiBase, "POST", `repos/${repo}/actions/variables`, token, { name, value: label }));
}
