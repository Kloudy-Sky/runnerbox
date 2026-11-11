import type { ProviderStatus } from "@runnerbox/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Stream from "effect/Stream";
import type { AgentTools } from "../AgentTools.ts";

export class ProviderError extends Schema.TaggedError<ProviderError>()("ProviderError", { message: Schema.String }) {}

// What one turn produces, in order. `Text` closes the text its deltas streamed.
export type ProviderEvent =
  | { readonly _tag: "TextDelta"; readonly text: string }
  | { readonly _tag: "Text"; readonly text: string }
  | { readonly _tag: "ToolCall"; readonly name: string; readonly input: unknown }
  | { readonly _tag: "Done"; readonly costUsd: number | null };

export type TurnInput = {
  readonly systemPrompt: string;
  // The whole conversation so far, packet first. Threads keep their own log, so a provider never
  // needs session state of its own, and a thread survives the provider's process.
  readonly prompt: string;
  readonly tools: AgentTools;
};

// One agent provider on the environment. Claude today; another provider is another layer.
// Interrupting the stream must stop the provider's work.
export class ProviderAdapter extends Context.Service<
  ProviderAdapter,
  {
    readonly status: Effect.Effect<ProviderStatus>;
    readonly runTurn: (input: TurnInput) => Stream.Stream<ProviderEvent, ProviderError>;
  }
>()("runnerbox/server/threads/ProviderAdapter") {}
