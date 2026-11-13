import { type ChildProcess, execFile, spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { newId } from "../../auth/secrets.ts";
import * as ServerPaths from "../../config/ServerPaths.ts";
import { claudeArgs, claudeEnv, mcpConfig, promptLine } from "./claudeCommand.ts";
import { decodeLine } from "./claudeMessages.ts";
import { ProviderAdapter, ProviderError, type ProviderEvent, type TurnInput } from "./ProviderAdapter.ts";

const PROVIDER = "Claude";
const INSTALL_FIX = "Install Claude Code on this machine and run `claude` once to sign in.";
const SIGN_IN_FIX = "Run `claude` on this machine once to sign in.";
const STDERR_KEPT = 2000;
// How Claude Code reports a key the API won't take.
const KEY_REFUSED = /invalid api key|invalid x-api-key|authentication_error/i;

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
// `loggedIn` is kept: the rest names the account. It runs with the same environment as turns, so
// an API key in the server's environment can't make it look signed in.
const AuthStatus = Schema.fromJsonString(Schema.Struct({ loggedIn: Schema.Boolean }));
const signedIn = (executable: string) =>
  Effect.callback<boolean>((resume) => {
    execFile(executable, ["auth", "status", "--json"], { timeout: 15_000, env: claudeEnv(process.env) }, (_error, stdout) => {
      const status = Schema.decodeUnknownOption(AuthStatus)(stdout.trim());
      resume(Effect.succeed(status._tag === "Some" && status.value.loggedIn));
    });
  });

// Resolves with the exit code, or the spawn error's message when `claude` couldn't start.
const exited = (child: ChildProcess) =>
  new Promise<number | string>((resolve) => {
    child.once("error", (error) => resolve(error.message));
    child.once("close", (code) => resolve(code ?? -1));
  });

const make = Effect.gen(function* () {
  const { serverDir } = yield* ServerPaths.ServerPaths;
  // An empty working directory, so no project files, CLAUDE.md or .mcp.json are near. Each
  // turn's MCP config lives beside it, owner-only, for as long as the turn runs.
  const cwd = join(serverDir, "agent", "cwd");
  const configDir = join(serverDir, "agent", "mcp");
  // An account's model wins; then `RUNNERBOX_CLAUDE_MODEL`; otherwise Claude Code's default.
  const envModel = process.env.RUNNERBOX_CLAUDE_MODEL || undefined;

  const probe = Effect.gen(function* () {
    const executable = findClaude();
    if (executable === null) return { provider: PROVIDER, available: false, fix: INSTALL_FIX };
    return (yield* signedIn(executable)) ? { provider: PROVIDER, available: true, fix: null } : { provider: PROVIDER, available: false, fix: SIGN_IN_FIX };
  });
  const loginStatus = yield* Effect.cachedWithTTL(probe, "1 minute");
  // An API account needs only the CLI; the subscription account also needs its login.
  const status = (account: { readonly hasKey: boolean }) =>
    account.hasKey
      ? Effect.sync(() => (findClaude() === null ? { provider: PROVIDER, available: false, fix: INSTALL_FIX } : { provider: PROVIDER, available: true, fix: null }))
      : loginStatus;

  const failed = (message: string) => new ProviderError({ message });

  const runTurn = (input: TurnInput) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const executable = findClaude();
        if (executable === null) return yield* failed(INSTALL_FIX);
        const mcpConfigPath = yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: async () => {
              await mkdir(cwd, { recursive: true, mode: 0o700 });
              await mkdir(configDir, { recursive: true, mode: 0o700 });
              const path = join(configDir, `${newId()}.json`);
              await writeFile(path, mcpConfig(input.mcp.url, input.mcp.token), { mode: 0o600, flag: "wx" });
              return path;
            },
            catch: () => failed("Couldn't write the turn's MCP config on the server."),
          }),
          (path) => Effect.promise(() => rm(path, { force: true })),
        );
        // Closing the stream's scope, on interrupt or at the end, stops the process.
        const child = yield* Effect.acquireRelease(
          Effect.sync(() =>
            spawn(executable, claudeArgs({ mcpConfigPath, systemPrompt: input.systemPrompt, model: input.account.model ?? envModel, reproduce: input.reproduce, propose: input.propose }), {
              cwd,
              env: claudeEnv(process.env, input.account.apiKey),
              stdio: ["pipe", "pipe", "pipe"],
            }),
          ),
          (process) => Effect.sync(() => process.exitCode === null && process.signalCode === null && process.kill("SIGTERM")),
        );
        const exit = exited(child);
        let stderr = "";
        child.stderr?.on("data", (chunk: Buffer) => {
          stderr = (stderr + chunk.toString()).slice(-STDERR_KEPT);
        });
        child.stdin?.on("error", () => {});
        child.stdin?.end(promptLine(input.prompt));

        let finished = false;
        const lines = Stream.fromAsyncIterable(createInterface({ input: child.stdout! }), () => failed("Couldn't read Claude Code's output."));
        // A turn that ends without a result line ended because `claude` did: say how.
        const outcome = Stream.fromEffect(
          Effect.promise(() => exit).pipe(
            Effect.flatMap((code) =>
              finished ? Effect.void : Effect.fail(failed(`Claude Code ${typeof code === "string" ? `couldn't start: ${code}` : `exited ${code}`}. ${stderr.trim().split("\n").at(-1) ?? ""}`.trim())),
            ),
          ),
        ).pipe(Stream.drain);
        return lines.pipe(
          Stream.mapEffect((line) => {
            const { events, error } = decodeLine(line);
            if (error !== null) return Effect.fail(failed(input.account.apiKey !== null && KEY_REFUSED.test(error) ? `The API key for "${input.account.label}" was refused. Replace it in Settings, Accounts.` : error));
            if (events.some((event) => event._tag === "Done")) finished = true;
            return Effect.succeed<ReadonlyArray<ProviderEvent>>(events);
          }),
          Stream.flattenIterable,
          Stream.concat(outcome),
        );
      }),
    );

  return ProviderAdapter.of({ status, runTurn });
});

export const layer = Layer.effect(ProviderAdapter, make);
