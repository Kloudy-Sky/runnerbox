import type { HarnessModel, ProviderStatus } from "@runnerbox/contracts";
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
  // Images the owner attached to this question, sent beside the prompt for the model to see.
  readonly images: ReadonlyArray<TurnImage>;
  // runnerbox's own `/mcp` on loopback, and a read-only token that lasts this turn only.
  readonly mcp: { readonly url: string; readonly token: string };
  // Whether the thread has a reproduce running, which adds its shell tool to this turn.
  readonly reproduce: boolean;
  // Whether the turn may record a proposed change: one the owner asked, not a monitor's.
  readonly propose: boolean;
  // A review's turn: its only tools read the pull request's code and hand the review in, and it
  // gets the steps and effort reading a codebase takes.
  readonly review: boolean;
  // The effort level picked for this turn, one its model offers; null for the model's own default.
  readonly effort: string | null;
  // The account the turn runs as. Its key, if any, is the only credential that reaches the provider.
  readonly account: TurnAccount;
};

export type TurnImage = { readonly mimeType: string; readonly base64: string };

// `home`: the owner's own CLI home, absolute, when the account uses their login; null for Runnerbox's own.
export type TurnAccount = { readonly label: string; readonly model: string | null; readonly apiKey: string | null; readonly home: string | null };

// One driver: how turns run on one kind of provider, Claude or Codex, each registered in Drivers.
// Interrupting the stream must stop the provider's work.
export class ProviderAdapter extends Context.Service<
  ProviderAdapter,
  {
    // Whether an account can run turns here: an API account needs only the CLI, a subscription
    // account also needs its login.
    readonly status: (account: { readonly hasKey: boolean; readonly home: string | null }) => Effect.Effect<ProviderStatus>;
    // The models a turn may pick here: the driver's own list, less any the installed CLI can't run.
    readonly models: Effect.Effect<ReadonlyArray<HarnessModel>>;
    readonly runTurn: (input: TurnInput) => Stream.Stream<ProviderEvent, ProviderError>;
  }
>()("runnerbox/server/threads/ProviderAdapter") {}

// Codex's adapter, apart from Claude's, so a server runs Codex only when it was given one.
export class CodexProviderAdapter extends Context.Service<CodexProviderAdapter, ProviderAdapter["Service"]>()("runnerbox/server/threads/CodexProviderAdapter") {}
