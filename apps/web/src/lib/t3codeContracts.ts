// A stand-in of runnerbox's, not T3 Code's package: what the copied web code takes from
// `@t3tools/contracts` and `@t3tools/contracts/settings`, which tsconfig and Vite map here.
// The composer's context, clipboard, citation and base schemas are T3 Code's own files, copied
// under `t3tools/contracts`; the rest are only the shapes the copies type-check against, since
// runnerbox has no keybindings config, client settings or provider skills.
export * from "../t3tools/contracts/assistantCitations.ts";
export * from "../t3tools/contracts/baseSchemas.ts";
export * from "../t3tools/contracts/composerContext.ts";
export * from "../t3tools/contracts/composerContextClipboard.ts";
import * as Schema from "effect/Schema";
import { EnvironmentId, ThreadId } from "../t3tools/contracts/baseSchemas.ts";

// As T3 Code's `environment.ts` defines it: a thread on one environment.
export const ScopedThreadRef = Schema.Struct({ environmentId: EnvironmentId, threadId: ThreadId });
export type ScopedThreadRef = typeof ScopedThreadRef.Type;

// T3 Code's server reports a provider's skills; runnerbox's never does, so the list is empty.
export type ServerProviderSkill = {
  readonly name: string;
  readonly description?: string | undefined;
  readonly path: string;
  readonly scope?: string | undefined;
  readonly enabled: boolean;
  readonly displayName?: string | undefined;
  readonly shortDescription?: string | undefined;
  readonly userInvocationOnly?: boolean | undefined;
  readonly userInvocable?: boolean | undefined;
};

// Runnerbox binds no keys of its own, so the resolved list is always empty.
export type ResolvedKeybindingsConfig = ReadonlyArray<never>;

export type ClientSettings = { readonly sendShortcut: "enter" | "mod-enter-multiline" | "mod-enter" };
