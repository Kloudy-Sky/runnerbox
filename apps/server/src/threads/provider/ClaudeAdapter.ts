import { execFile } from "node:child_process";
import { accessSync, constants, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ServerPaths from "../../config/ServerPaths.ts";
import { claudeOptions } from "./claudeOptions.ts";
import { decodeMessage } from "./claudeMessages.ts";
import { ProviderAdapter, ProviderError, type TurnInput } from "./ProviderAdapter.ts";

const PROVIDER = "Claude";
const INSTALL_FIX = "Install Claude Code on this machine and run `claude` once to sign in.";
const SIGN_IN_FIX = "Run `claude` on this machine once to sign in.";

// A service's PATH is often bare, so the installer's usual places are looked at too.
function findClaude(): string | null {
  const candidates = [
    ...(process.env.PATH ?? "").split(delimiter).filter(Boolean).map((dir) => join(dir, "claude")),
    join(homedir(), ".local", "bin", "claude"),
    join(homedir(), ".claude", "local", "claude"),
  ];
  return (
    candidates.find((path) => {
      try {
        accessSync(path, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    }) ?? null
  );
}

// `claude auth status` says whether there's a login, without runnerbox reading it. Only
// `loggedIn` is kept: the rest names the account.
const AuthStatus = Schema.fromJsonString(Schema.Struct({ loggedIn: Schema.Boolean }));
const signedIn = (executable: string) =>
  Effect.callback<boolean>((resume) => {
    execFile(executable, ["auth", "status", "--json"], { timeout: 15_000 }, (_error, stdout) => {
      const status = Schema.decodeUnknownOption(AuthStatus)(stdout.trim());
      resume(Effect.succeed(status._tag === "Some" && status.value.loggedIn));
    });
  });

const make = Effect.gen(function* () {
  const { serverDir } = yield* ServerPaths.ServerPaths;
  const cwd = join(serverDir, "agent");
  // `RUNNERBOX_CLAUDE_MODEL` picks a model; otherwise Claude Code's default for the login.
  const model = process.env.RUNNERBOX_CLAUDE_MODEL || undefined;

  const probe = Effect.gen(function* () {
    const executable = findClaude();
    if (executable === null) return { provider: PROVIDER, available: false, fix: INSTALL_FIX };
    return (yield* signedIn(executable)) ? { provider: PROVIDER, available: true, fix: null } : { provider: PROVIDER, available: false, fix: SIGN_IN_FIX };
  });
  const status = yield* Effect.cachedWithTTL(probe, "1 minute");

  const runTurn = (input: TurnInput) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const executable = findClaude();
        if (executable === null) return yield* new ProviderError({ message: INSTALL_FIX });
        yield* Effect.sync(() => mkdirSync(cwd, { recursive: true, mode: 0o700 }));
        // Interrupting the stream closes its scope, which aborts the Claude Code process.
        const abortController = yield* Effect.acquireRelease(
          Effect.sync(() => new AbortController()),
          (controller) => Effect.sync(() => controller.abort()),
        );
        const messages = query({
          prompt: input.prompt,
          options: claudeOptions({ executable, cwd, model, systemPrompt: input.systemPrompt, tools: input.tools, abortController, env: process.env }),
        });
        return Stream.fromAsyncIterable(messages, (cause) => new ProviderError({ message: cause instanceof Error ? cause.message : String(cause) })).pipe(
          Stream.mapEffect((message) => {
            const { events, error } = decodeMessage(message);
            return error === null ? Effect.succeed(events) : Effect.fail(new ProviderError({ message: error }));
          }),
          Stream.flattenIterable,
        );
      }),
    );

  return ProviderAdapter.of({ status, runTurn });
});

export const layer = Layer.effect(ProviderAdapter, make);
