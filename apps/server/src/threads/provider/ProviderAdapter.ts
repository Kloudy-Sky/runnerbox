import type { ProviderStatus } from "@runnerbox/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Stream from "effect/Stream";

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
  // runnerbox's own `/mcp` on loopback, and a read-only token that lasts this turn only.
  readonly mcp: { readonly url: string; readonly token: string };
  // Whether the thread has a reproduce running, which adds its shell tool to this turn.
  readonly reproduce: boolean;
  // The account the turn runs as. Its key, if any, is the only credential that reaches the provider.
  readonly account: TurnAccount;
};

export type TurnAccount = { readonly label: string; readonly model: string | null; readonly apiKey: string | null };

// One driver: how turns run on one kind of provider. Claude today; Codex would be a second
// adapter registered in Drivers. Interrupting the stream must stop the provider's work.
export class ProviderAdapter extends Context.Service<
  ProviderAdapter,
  {
    // Whether an account can run turns here: an API account needs only the CLI, a subscription
    // account also needs its login.
    readonly status: (account: { readonly hasKey: boolean }) => Effect.Effect<ProviderStatus>;
    readonly runTurn: (input: TurnInput) => Stream.Stream<ProviderEvent, ProviderError>;
  }
>()("runnerbox/server/threads/ProviderAdapter") {}
