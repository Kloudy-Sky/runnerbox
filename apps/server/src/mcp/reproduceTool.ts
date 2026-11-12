import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { MAX_COMMAND_LENGTH, MAX_COMMAND_SECONDS } from "runnerbox/src/reproduce/protocol.ts";
import { ToolFailure } from "./tools.ts";

// The one tool that changes anything: a shell command in the thread's reproduce container. Every
// MCP token sees it, but only a thread's turn token, while the owner's reproduce runs, can use it.
export const ReproduceToolkit = Toolkit.make(
  Tool.make("repro_exec", {
    description: `Runs one shell command in this thread's reproduce container, in /work with the job's commit's files, and returns its exit code and the end of its output. Only works in a runnerbox thread after the owner starts a reproduce. One command at a time; at most ${MAX_COMMAND_SECONDS} seconds each.`,
    parameters: Schema.Struct({
      command: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_COMMAND_LENGTH)),
      timeoutSec: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: MAX_COMMAND_SECONDS }))
        .pipe(Schema.withDecodingDefault(Effect.succeed(300)))
        .annotate({ description: `Seconds before the command is killed, 1 to ${MAX_COMMAND_SECONDS}. Default 300.` }),
    }),
    success: Schema.Struct({ exitCode: Schema.NullOr(Schema.Int), timedOut: Schema.Boolean, output: Schema.String, truncated: Schema.Boolean, commandsLeft: Schema.Int }),
    failure: ToolFailure,
    failureMode: "return",
  }).annotateMerge(Context.make(Tool.Readonly, false).pipe(Context.add(Tool.Destructive, true))),
);
