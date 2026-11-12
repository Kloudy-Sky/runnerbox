import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { ProviderAdapter, ProviderError, type ProviderEvent, type TurnInput } from "../threads/provider/ProviderAdapter.ts";
import { mcpSession } from "./mcpClient.ts";

export type ToolResult = { readonly status: number; readonly text: string; readonly isError: boolean };

// Calls one tool the way Claude Code would: over the turn's `/mcp` URL with its token.
async function callTool(mcp: TurnInput["mcp"], name: string, input: unknown): Promise<ToolResult> {
  const { init, request } = await mcpSession(mcp.url, mcp.token);
  if (init.status !== 200) return { status: init.status, text: "", isError: true };
  const { body } = await request("tools/call", { name, arguments: input ?? {} });
  const result: { content?: { text: string }[]; isError?: boolean } | undefined = body.result;
  return result ? { status: 200, text: result.content?.map((part) => part.text).join("") ?? "", isError: result.isError === true } : { status: 200, text: JSON.stringify(body.error), isError: true };
}

// A provider that replays scripted turns, for tests and for driving the app without spending a
// subscription. Text streams word by word; a tool step really calls `/mcp` with the turn's token.
export type FakeStep =
  | { readonly text: string }
  | { readonly tool: string; readonly input?: unknown }
  | { readonly fail: string }
  // Never finishes, so the turn can be interrupted mid-stream.
  | { readonly hang: true };

export function makeFakeProvider(options: { readonly turns: ReadonlyArray<ReadonlyArray<FakeStep>>; readonly available?: boolean; readonly delayMs?: number }) {
  const inputs: TurnInput[] = [];
  const toolResults: ToolResult[] = [];
  const pause = Effect.sleep(options.delayMs ?? 0);

  const play = (step: FakeStep, input: TurnInput): Stream.Stream<ProviderEvent, ProviderError> => {
    if ("text" in step) {
      const words = step.text.split(/(?<= )/);
      return Stream.fromIterable(words).pipe(
        Stream.mapEffect((word) => pause.pipe(Effect.as<ProviderEvent>({ _tag: "TextDelta", text: word }))),
        Stream.concat(Stream.succeed<ProviderEvent>({ _tag: "Text", text: step.text })),
      );
    }
    if ("tool" in step) {
      return Stream.fromEffect(
        Effect.promise(() => callTool(input.mcp, step.tool, step.input)).pipe(
          Effect.tap((result) => Effect.sync(() => toolResults.push(result))),
          Effect.as<ProviderEvent>({ _tag: "ToolCall", name: step.tool, input: step.input ?? {} }),
        ),
      );
    }
    if ("fail" in step) return Stream.fail(new ProviderError({ message: step.fail }));
    return Stream.never;
  };

  const layer = Layer.succeed(ProviderAdapter)({
    status: Effect.succeed(options.available === false ? { provider: "Fake", available: false, fix: "Install Claude Code on this machine and run `claude` once to sign in." } : { provider: "Fake", available: true, fix: null }),
    runTurn: (input) =>
      Stream.suspend(() => {
        const script = options.turns[inputs.length % options.turns.length] ?? [];
        inputs.push(input);
        return Stream.fromIterable(script).pipe(
          Stream.flatMap((step) => play(step, input)),
          Stream.concat(Stream.succeed<ProviderEvent>({ _tag: "Done", costUsd: 0 })),
        );
      }),
  });

  return { layer, inputs, toolResults };
}
