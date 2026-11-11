import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import type { ToolResult } from "../threads/AgentTools.ts";
import { ProviderAdapter, ProviderError, type ProviderEvent, type TurnInput } from "../threads/provider/ProviderAdapter.ts";

// A provider that replays scripted turns, for tests and for driving the app without spending a
// subscription. Text streams word by word; a tool step really calls the thread's tools.
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
        Effect.promise(() => input.tools.call(step.tool, step.input)).pipe(
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
