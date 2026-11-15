import { type ChildProcess, execFile, spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";
import type { ProviderStatus } from "@runnerbox/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ServerPaths from "../../config/ServerPaths.ts";
import { allowedTools, appliedProblems, appServerArgs, launchProblems, maxSteps, SUPPORTED_CODEX_LABEL, supportedVersion, threadStartParams, TOKEN_ENV, turnStartParams } from "./codexAppServer.ts";
import { codexEnv, codexHome } from "./codexCommand.ts";
import { decodeMessage, type ErrorResponse, type Response, ThreadStarted } from "./codexProtocol.ts";
import { decide, type TurnState } from "./codexTurnPolicy.ts";
import { HARNESSES } from "./harnesses.ts";
import { CodexProviderAdapter, ProviderError, type ProviderEvent, type TurnInput } from "./ProviderAdapter.ts";

const PROVIDER = HARNESSES.codex.label;
const INSTALL_FIX = "Install Codex on this machine.";
// The command Settings shows, run on the machine as the server's user.
const SIGN_IN_FIX = "Run `runnerbox codex-login` on this machine to sign in Runnerbox's own Codex home.";

// A service's PATH is often bare, so the installers' usual places are looked at too.
export function findCodex(): string | null {
  const candidates = [
    ...(process.env.PATH ?? "").split(delimiter).filter(Boolean).map((dir) => join(dir, "codex")),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    join(homedir(), ".local", "bin", "codex"),
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

// The home is made owner-only before `codex` runs, since it would otherwise make it itself, open to all.
const STDERR_KEPT = 2000;
const decodeThreadStarted = Schema.decodeUnknownOption(ThreadStarted);

// Resolves with the exit code, or the spawn error's message when `codex` couldn't start.
const exited = (child: ChildProcess) =>
  new Promise<number | string>((resolve) => {
    child.once("error", (error) => resolve(error.message));
    child.once("close", (code) => resolve(code ?? -1));
  });

// Ends Codex and everything it started: the group gets SIGTERM now, and SIGKILL if it's still there.
export function killGroup(child: ChildProcess) {
  const { pid } = child;
  if (pid === undefined) return;
  const signal = (name: NodeJS.Signals) => {
    try {
      process.kill(-pid, name);
    } catch {
      // The group is already gone.
    }
  };
  signal("SIGTERM");
  setTimeout(() => signal("SIGKILL"), 2000).unref();
}

const run = (executable: string, args: ReadonlyArray<string>, home: string) =>
  Effect.promise(() => mkdir(home, { recursive: true, mode: 0o700 })).pipe(
    Effect.andThen(
      Effect.callback<{ readonly ok: boolean; readonly stdout: string }>((resume) => {
        execFile(executable, args, { timeout: 15_000, env: codexEnv(process.env, home), maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => resume(Effect.succeed({ ok: error === null, stdout })));
      }),
    ),
  );

// `codex debug models` lists the installed CLI's catalog without a sign-in or a model call. Only
// slugs it shows (not hidden ones) are kept.
const Catalog = Schema.fromJsonString(Schema.Struct({ models: Schema.Array(Schema.Struct({ slug: Schema.String, visibility: Schema.optional(Schema.String) })) }));

// Spoken to as T3 Code's Codex adapter speaks to it (MIT, see THIRD_PARTY_NOTICES.md), with a
// client of Runnerbox's own for the few messages a turn uses.
export const makeWith = (find: () => string | null) =>
  Effect.gen(function* () {
    const { serverDir } = yield* ServerPaths.ServerPaths;
    const home = codexHome(serverDir);
    const cwd = join(serverDir, "agent", "cwd");
    // A key account's turns each get a home of their own, made and removed with the turn, so its key
    // never meets the login in Runnerbox's shared one.
    const turnHomes = join(serverDir, "agent", "codex-turns");

    // Whether Codex is installed, and a release this adapter was checked against.
    const installedProbe = Effect.gen(function* () {
      const executable = find();
      if (executable === null) return { provider: PROVIDER, available: false, fix: INSTALL_FIX } satisfies ProviderStatus;
      const { stdout } = yield* run(executable, ["--version"], home);
      return supportedVersion(stdout)
        ? ({ provider: PROVIDER, available: true, fix: null } satisfies ProviderStatus)
        : ({ provider: PROVIDER, available: false, fix: `Runnerbox runs Codex ${SUPPORTED_CODEX_LABEL}; this machine has ${stdout.trim() || "an unknown version"}.` } satisfies ProviderStatus);
    });
    const installed = yield* Effect.cachedWithTTL(installedProbe, "1 minute");
    // `codex login status` exits 0 when the home is signed in. Runnerbox never reads the login itself.
    const loginProbe = Effect.gen(function* () {
      const ready = yield* installed;
      if (!ready.available) return ready;
      const { ok } = yield* run(find() ?? "codex", ["login", "status"], home);
      return { provider: PROVIDER, available: ok, fix: ok ? null : SIGN_IN_FIX } satisfies ProviderStatus;
    });
    const loginStatus = yield* Effect.cachedWithTTL(loginProbe, "1 minute");
    // An API account needs only the CLI; a login account also needs Runnerbox's home signed in.
    const status = (account: { readonly hasKey: boolean }) => (account.hasKey ? installed : loginStatus);

    const listed = Effect.gen(function* () {
      const executable = find();
      if (executable === null) return [];
      const { ok, stdout } = yield* run(executable, ["debug", "models"], home);
      const catalog = Schema.decodeUnknownOption(Catalog)(stdout);
      if (!ok || catalog._tag === "None") return [];
      return HARNESSES.codex.models.filter((model) => catalog.value.models.some((each) => each.slug === model.id && each.visibility !== "hide"));
    });
    const models = yield* Effect.cachedWithTTL(listed, "10 minutes");

    const failed = (message: string) => new ProviderError({ message });

    const runTurn = (input: TurnInput) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const executable = find();
          if (executable === null) return yield* failed(INSTALL_FIX);
          const ready = yield* installed;
          if (!ready.available) return yield* failed(ready.fix ?? INSTALL_FIX);
          const turn = { mcpUrl: input.mcp.url, propose: input.propose, reproduce: input.reproduce };
          const args = appServerArgs(turn);
          const thread = threadStartParams({ cwd, systemPrompt: input.systemPrompt, model: input.account.model ?? undefined });
          const problems = launchProblems(turn, args, thread);
          if (problems.length > 0) return yield* failed(`Runnerbox didn't start Codex: it would have run without ${problems.join(", ")}.`);
          yield* Effect.tryPromise({ try: () => mkdir(cwd, { recursive: true, mode: 0o700 }), catch: () => failed("Couldn't make the turn's working directory on the server.") });
          const turnHome =
            input.account.apiKey === null
              ? home
              : yield* Effect.acquireRelease(
                  Effect.tryPromise({
                    try: async () => {
                      await mkdir(turnHomes, { recursive: true, mode: 0o700 });
                      return mkdtemp(join(turnHomes, "turn-"));
                    },
                    catch: () => failed("Couldn't make the turn's Codex home on the server."),
                  }),
                  (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
                );
          // Its own process group, so ending the turn ends everything Codex started.
          const child = yield* Effect.acquireRelease(
            Effect.sync(() =>
              spawn(executable, args, {
                cwd,
                env: { ...codexEnv(process.env, turnHome, input.account.apiKey), [TOKEN_ENV]: input.mcp.token },
                stdio: ["pipe", "pipe", "pipe"],
                detached: true,
              }),
            ),
            (process) => Effect.sync(() => killGroup(process)),
          );
          return talk(child, turn, thread, input);
        }),
      );

    // The handshake, then the turn: every line decoded, and every message after the prompt judged by
    // codexTurnPolicy. The stream ends on the turn's end, which closes its scope and the process.
    const talk = (child: ChildProcess, turn: { readonly propose: boolean; readonly reproduce: boolean }, thread: ReturnType<typeof threadStartParams>, input: TurnInput) => {
      const exit = exited(child);
      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-STDERR_KEPT);
      });
      child.stdin?.on("error", () => {});
      const send = (message: unknown) => child.stdin?.write(`${JSON.stringify(message)}\n`);
      send({ id: 1, method: "initialize", params: { clientInfo: { name: "runnerbox", version: "1" }, capabilities: { experimentalApi: true } } });
      const state: TurnState = { steps: 0, allowed: new Set(allowedTools(turn)), maxSteps: maxSteps(turn) };
      let finished = false;
      // Answers to Runnerbox's own three requests: initialize, then thread/start, then turn/start.
      const answer = (response: typeof Response.Type | typeof ErrorResponse.Type): Effect.Effect<ReadonlyArray<ProviderEvent>, ProviderError> => {
        if ("error" in response) return Effect.fail(failed(`Codex refused to start: ${response.error.message}`));
        if (response.id === 1) {
          send({ method: "initialized" });
          send({ id: 2, method: "thread/start", params: thread });
          return Effect.succeed([]);
        }
        if (response.id === 2) {
          const started = decodeThreadStarted(response.result);
          if (started._tag === "None") return Effect.fail(failed("Codex started a thread Runnerbox couldn't read."));
          const problems = appliedProblems(started.value);
          if (problems.length > 0) return Effect.fail(failed(`Runnerbox didn't send the question: Codex says ${problems.join(", ")}.`));
          send({ id: 3, method: "turn/start", params: turnStartParams(started.value.thread.id, input.prompt, input.images) });
          return Effect.succeed([]);
        }
        return response.id === 3 ? Effect.succeed([]) : Effect.fail(failed("Codex answered a request Runnerbox didn't make."));
      };
      const lines = Stream.fromAsyncIterable(createInterface({ input: child.stdout! }), () => failed("Couldn't read Codex's output."));
      // A turn that ends without its end message ended because `codex` did: say how.
      const outcome = Stream.fromEffect(
        Effect.suspend(() =>
          finished
            ? Effect.void
            : Effect.promise(() => exit).pipe(
                Effect.flatMap((code) => Effect.fail(failed(`Codex ${typeof code === "string" ? `couldn't start: ${code}` : `exited ${code}`}. ${stderr.trim().split("\n").at(-1) ?? ""}`.trim()))),
              ),
        ),
      ).pipe(Stream.drain);
      return lines.pipe(
        Stream.mapEffect((line) => {
          const message = decodeMessage(line);
          if (message._tag === "None") return Effect.fail(failed("Codex sent a line Runnerbox couldn't read. The turn was stopped."));
          const value = message.value;
          if (!("method" in value)) return answer(value);
          const decision = decide(value, state);
          if (decision.reply) send(decision.reply);
          if (decision.end?._tag === "Stopped") return Effect.fail(failed(decision.end.message));
          if (decision.end?._tag === "Done") finished = true;
          return Effect.succeed(decision.events);
        }),
        Stream.flattenIterable,
        Stream.takeUntil((event) => event._tag === "Done"),
        Stream.concat(outcome),
      );
    };

    return CodexProviderAdapter.of({ status, models, runTurn });
  });

export const layer = Layer.effect(CodexProviderAdapter, makeWith(findCodex));
