import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { Tool } from "effect/ai";
import type * as JobHistory from "../history/JobHistory.ts";
import type * as Inbox from "../inbox/Inbox.ts";
import * as Handlers from "../mcp/handlers.ts";
import type * as LauncherLogs from "../runners/LauncherLogs.ts";
import type * as RunnerState from "../runners/RunnerState.ts";
import { RunnerboxToolkit } from "../mcp/tools.ts";

export type ToolDefinition = { readonly name: string; readonly description: string; readonly inputSchema: Record<string, unknown> };
export type ToolResult = { readonly text: string; readonly isError: boolean };

// The only things an agent in a thread can do: the read-only tools `/mcp` serves, over the same
// handlers and services, called in process. A name outside the toolkit is refused here too.
export type AgentTools = {
  readonly definitions: ReadonlyArray<ToolDefinition>;
  readonly call: (name: string, input: unknown) => Promise<ToolResult>;
};

const failure = (text: string): ToolResult => ({ text, isError: true });

// Needs the services the MCP handlers read, which the server's layer provides.
export const make = Effect.gen(function* () {
  const toolkit = yield* RunnerboxToolkit.pipe(Effect.provide(Handlers.layer));
  const context = yield* Effect.context<JobHistory.JobHistory | LauncherLogs.LauncherLogs | Inbox.Inbox | RunnerState.RunnerState>();
  const tools = Object.values(toolkit.tools);
  type Name = keyof typeof toolkit.tools;
  const isName = (name: string): name is Name => Object.hasOwn(toolkit.tools, name);
  const definitions = tools.map((tool) => ({
    name: tool.name,
    description: Tool.getDescription(tool) ?? tool.name,
    inputSchema: { ...Tool.getJsonSchema(tool) },
  }));
  const call = (name: string, input: unknown): Promise<ToolResult> => {
    if (!isName(name)) return Promise.resolve(failure(`No tool is named ${name}.`));
    // The handler decodes `input` against the tool's schema before anything runs.
    return toolkit.handle(name, (input ?? {}) as never).pipe(
      Stream.unwrap,
      Stream.runLast,
      Effect.map((last) =>
        last._tag === "None" ? failure("The tool returned nothing.") : { text: JSON.stringify(last.value.encodedResult), isError: last.value.isFailure },
      ),
      // A bad argument is the model's mistake to correct, so it gets the reason back.
      Effect.catchCause((cause) => Effect.succeed(failure(Cause.pretty(cause).split("\n")[0] ?? "The tool failed."))),
      Effect.provideContext(context),
      Effect.runPromise,
    );
  };
  return { definitions, call } satisfies AgentTools;
});
