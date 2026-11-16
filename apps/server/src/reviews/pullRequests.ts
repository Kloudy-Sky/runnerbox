import type { PullRequest } from "@runnerbox/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { COMMIT_ID } from "./gitObjects.ts";

const TITLE_CHARS = 200;
const NAME_CHARS = 100;

// GitHub's reply is outside input: only these fields are read, and anything else is ignored.
const Pulls = Schema.Array(
  Schema.Struct({
    number: Schema.Int,
    title: Schema.String,
    draft: Schema.optionalKey(Schema.Boolean),
    user: Schema.NullOr(Schema.Struct({ login: Schema.String })),
    head: Schema.Struct({ ref: Schema.String, sha: Schema.String }),
    base: Schema.Struct({ ref: Schema.String }),
    created_at: Schema.String,
    updated_at: Schema.String,
  }),
);

// One pull request as GitHub describes it alone, which adds what a review needs to what the list has.
const Pull = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  body: Schema.NullOr(Schema.String),
  state: Schema.String,
  draft: Schema.optionalKey(Schema.Boolean),
  user: Schema.NullOr(Schema.Struct({ login: Schema.String })),
  head: Schema.Struct({ ref: Schema.String, sha: Schema.String }),
  base: Schema.Struct({ ref: Schema.String, sha: Schema.String }),
  additions: Schema.Int,
  deletions: Schema.Int,
  changed_files: Schema.Int,
  created_at: Schema.String,
  updated_at: Schema.String,
});
const DESCRIPTION_CHARS = 8000;

export type PullToReview = PullRequest & { readonly description: string; readonly baseSha: string; readonly additions: number; readonly deletions: number; readonly changedFiles: number };

// One line, without control characters or runs of spaces, cut to `max`: a title or branch is
// whatever its author typed.
const line = (text: string, max: number) => {
  const clean = text.replace(/[\p{Cc}\s]+/gu, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

// The open pull requests in one repository's reply, or null when the reply isn't a list of them.
export function pullsOf(repo: string, body: unknown): ReadonlyArray<PullRequest> | null {
  return Option.match(Schema.decodeUnknownOption(Pulls)(body), {
    onNone: () => null,
    onSome: (pulls) =>
      pulls.map((pull) => ({
        repo,
        number: pull.number,
        title: line(pull.title, TITLE_CHARS),
        author: line(pull.user?.login ?? "ghost", NAME_CHARS),
        branch: line(pull.head.ref, NAME_CHARS),
        base: line(pull.base.ref, NAME_CHARS),
        headSha: COMMIT_ID.test(pull.head.sha) ? pull.head.sha : "",
        draft: pull.draft ?? false,
        openedAt: pull.created_at,
        updatedAt: pull.updated_at,
      })),
  });
}

// An open pull request to review, or null when the reply isn't one, it's closed, or its commit IDs aren't commit IDs.
export function pullToReview(repo: string, body: unknown): PullToReview | null {
  const decoded = Schema.decodeUnknownOption(Pull)(body);
  if (Option.isNone(decoded)) return null;
  const pull = decoded.value;
  if (pull.state !== "open" || !COMMIT_ID.test(pull.head.sha) || !COMMIT_ID.test(pull.base.sha)) return null;
  return {
    repo,
    number: pull.number,
    title: line(pull.title, TITLE_CHARS),
    author: line(pull.user?.login ?? "ghost", NAME_CHARS),
    branch: line(pull.head.ref, NAME_CHARS),
    base: line(pull.base.ref, NAME_CHARS),
    headSha: pull.head.sha,
    baseSha: pull.base.sha,
    draft: pull.draft ?? false,
    openedAt: pull.created_at,
    updatedAt: pull.updated_at,
    description: (pull.body ?? "").slice(0, DESCRIPTION_CHARS),
    additions: pull.additions,
    deletions: pull.deletions,
    changedFiles: pull.changed_files,
  };
}
