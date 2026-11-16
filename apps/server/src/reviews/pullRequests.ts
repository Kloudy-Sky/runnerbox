import type { PullRequest } from "@runnerbox/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

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
        headSha: /^[0-9a-f]{40}$/.test(pull.head.sha) ? pull.head.sha : "",
        draft: pull.draft ?? false,
        openedAt: pull.created_at,
        updatedAt: pull.updated_at,
      })),
  });
}
