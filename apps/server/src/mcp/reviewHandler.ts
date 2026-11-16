import * as Effect from "effect/Effect";
import * as ReviewRuns from "../reviews/ReviewRuns.ts";
import { McpSession } from "./McpSession.ts";
import { ReviewToolkit } from "./reviewTool.ts";

// Each tool answers for the review whose turn token made the call, which the route already
// authenticated. Any other token is refused: it names no review, so it has no code to read.
export const layer = ReviewToolkit.toLayer(
  Effect.gen(function* () {
    const runs = yield* ReviewRuns.ReviewRuns;
    const session = Effect.serviceOption(McpSession).pipe(
      Effect.flatMap((found) => (found._tag === "Some" ? Effect.succeed(found.value.id) : Effect.fail({ message: "Only a review's own turn can read its code." }))),
    );
    return {
      read_file: ({ path, startLine, endLine }) => session.pipe(Effect.flatMap((id) => runs.readFile(id, path, startLine, endLine))),
      search_code: ({ pattern, glob, ignoreCase }) => session.pipe(Effect.flatMap((id) => runs.search(id, pattern, { glob, ignoreCase }))),
      list_files: ({ glob }) => session.pipe(Effect.flatMap((id) => runs.listFiles(id, glob))),
      submit_review: (review) => session.pipe(Effect.flatMap((id) => runs.submit(id, review)), Effect.as({ kept: true })),
    };
  }),
);
