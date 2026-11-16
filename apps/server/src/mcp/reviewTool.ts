import { ReviewImpact, ReviewPriority } from "@runnerbox/contracts";
import * as Context from "effect/Context";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { ToolFailure } from "./tools.ts";

// What a review's agent has: the pull request's repository at its head commit, to read, and one
// call that hands the review in. They answer only the token of a review's own turn, about that
// review's commit, so they name no repository and no commit.

const READ_ONLY = Context.make(Tool.Readonly, true).pipe(Context.add(Tool.Destructive, false));
const shared = { failure: ToolFailure, failureMode: "return" as const };
const path = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(400));
const glob = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)).annotate({ description: "Only paths matching this, such as `src/**/*.ts`. `**` crosses directories." });
const line = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_000_000 }));
const sentence = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(400));

export const SubmittedFinding = Schema.Struct({
  priority: ReviewPriority,
  title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
  path,
  startLine: line,
  endLine: line,
  body: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1200)),
  rule: Schema.NullOr(Schema.String.check(Schema.isMaxLength(400))),
});
export const SubmittedReview = Schema.Struct({
  score: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 5 })),
  impact: ReviewImpact,
  reach: sentence,
  verdict: sentence,
  findings: Schema.Array(SubmittedFinding).check(Schema.isMaxLength(20)),
});
export type SubmittedReview = typeof SubmittedReview.Type;

export const ReviewToolkit = Toolkit.make(
  Tool.make("read_file", {
    ...shared,
    description: "Lines of one file at the pull request's head commit, each with its number. Without a range it starts at line 1. At most 800 lines a call; `total` says how long the file is.",
    parameters: Schema.Struct({ path, startLine: Schema.optionalKey(line), endLine: Schema.optionalKey(line) }),
    success: Schema.Struct({ path: Schema.String, from: Schema.Int, to: Schema.Int, total: Schema.Int, lines: Schema.Array(Schema.Struct({ line: Schema.Int, text: Schema.String })) }),
  }).annotateMerge(READ_ONLY),
  Tool.make("search_code", {
    ...shared,
    description: "Lines matching a POSIX extended regular expression, across the text files at the head commit. At most 200 matches; `more` says there were others, so narrow the pattern or add a glob.",
    parameters: Schema.Struct({ pattern: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(300)), glob: Schema.optionalKey(glob), ignoreCase: Schema.optionalKey(Schema.Boolean) }),
    success: Schema.Struct({ matches: Schema.Array(Schema.Struct({ path: Schema.String, line: Schema.Int, text: Schema.String })), more: Schema.Boolean }),
  }).annotateMerge(READ_ONLY),
  Tool.make("list_files", {
    ...shared,
    description: "Paths of the files at the head commit. At most 500 a call; `more` counts the rest, so add a glob.",
    parameters: Schema.Struct({ glob: Schema.optionalKey(glob) }),
    success: Schema.Struct({ paths: Schema.Array(Schema.String), more: Schema.Int }),
  }).annotateMerge(READ_ONLY),
  Tool.make("submit_review", {
    ...shared,
    description: "Hands in the review. Call it once, when you have finished reading. It is kept for the owner and posted nowhere.",
    parameters: SubmittedReview,
    success: Schema.Struct({ kept: Schema.Boolean }),
  }).annotateMerge(Context.make(Tool.Readonly, false).pipe(Context.add(Tool.Destructive, false))),
);
