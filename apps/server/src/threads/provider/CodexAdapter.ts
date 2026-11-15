import { type ChildProcess, execFile, spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";
import type { ProviderStatus } from "@runnerbox/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ServerPaths from "../../config/ServerPaths.ts";
import { allowedTools, appliedProblems, appServerArgs, DISABLED_FEATURES, launchProblems, maxSteps, mcpProblems, SUPPORTED_CODEX_LABEL, supportedVersion, threadStartParams, TOKEN_ENV, turnStartParams } from "./codexAppServer.ts";
import { codexEnv, codexHome } from "./codexCommand.ts";
import { decodeMessage, type ErrorResponse, McpServers, type Response, ThreadStarted } from "./codexProtocol.ts";
import { decide, type TurnState } from "./codexTurnPolicy.ts";
import { HARNESSES } from "./harnesses.ts";
import { SERVER_NAME } from "./runnerboxTools.ts";
import { CodexProviderAdapter, ProviderError, type ProviderEvent, type TurnInput } from "./ProviderAdapter.ts";

const PROVIDER = HARNESSES.codex.label;
const INSTALL_FIX = "Install Codex on this machine.";
// The command Settings shows, run on the machine as the server's user.
const SIGN_IN_FIX = "Run `runnerbox codex-login` on this machine to sign in Runnerbox's own Codex home.";
// For an account on the owner's own Codex login: their usual sign-in.
const OWNER_SIGN_IN_FIX = "Run `codex login` on this machine to sign in your Codex login.";

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

const STDERR_KEPT = 2000;
const decodeThreadStarted = Schema.decodeUnknownOption(ThreadStarted);

// Resolves with the exit code, or the spawn error's message when `codex` couldn't start.
const exited = (child: ChildProcess) =>
  new Promise<number | string>((resolve) => {
    child.once("error", (error) => resolve(error.message));
    child.once("close", (code) => resolve(code ?? -1));
  });

// Ends Codex and everything it started: the group gets SIGTERM now, and SIGKILL 2 s later if it's
// still there. Resolves once Codex has closed, so nothing it writes outlives what's cleaned up after.
export function killGroup(child: ChildProcess) {
  const { pid } = child;
  const closed = new Promise<void>((resolve) => {
    if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("close", () => resolve());
  });
  if (pid === undefined) return closed;
  const signal = (name: NodeJS.Signals) => {
    try {
      process.kill(-pid, name);
    } catch {
      // The group is already gone.
    }
  };
  signal("SIGTERM");
  setTimeout(() => signal("SIGKILL"), 2000).unref();
  return closed;
}

// Runnerbox's own home is made owner-only before `codex` runs, since it would otherwise make it
// itself, open to all. The owner's home is theirs: Runnerbox never makes or changes it.
const run = (executable: string, args: ReadonlyArray<string>, home: string, own: boolean) =>
  (own ? Effect.promise(() => mkdir(home, { recursive: true, mode: 0o700 })) : Effect.void).pipe(
    Effect.andThen(
      Effect.callback<{ readonly ok: boolean; readonly stdout: string }>((resume) => {
        execFile(executable, args, { timeout: 15_000, env: codexEnv(process.env, home), maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => resume(Effect.succeed({ ok: error === null, stdout })));
      }),
    ),
  );

// `codex debug models` lists the installed CLI's catalog without a sign-in or a model call. Only
// slugs it shows (not hidden ones) are kept.
// `codex mcp list --json`, of which only each server's name and whether it's on are read.
const ServerList = Schema.fromJsonString(Schema.Array(Schema.Struct({ name: Schema.String, enabled: Schema.Boolean })));
const decodeServerList = Schema.decodeUnknownOption(ServerList);
const decodeMcpServers = Schema.decodeUnknownOption(McpServers);
const Catalog = Schema.fromJsonString(Schema.Struct({ models: Schema.Array(Schema.Struct({ slug: Schema.String, visibility: Schema.optional(Schema.String) })) }));

// Spoken to as T3 Code's Codex adapter speaks to it (MIT, see THIRD_PARTY_NOTICES.md), with a
// client of Runnerbox's own for the few messages a turn uses.
export const makeWith = (find: () => string | null) =>
  Effect.gen(function* () {
    const { serverDir } = yield* ServerPaths.ServerPaths;
    const home = codexHome(serverDir);
    const cwd = join(serverDir, "agent", "cwd");

    // Whether Codex is installed, and a release this adapter was checked against.
    const installedProbe = Effect.gen(function* () {
      const executable = find();
      if (executable === null) return { provider: PROVIDER, available: false, fix: INSTALL_FIX } satisfies ProviderStatus;
      const { stdout } = yield* run(executable, ["--version"], home, true);
      return supportedVersion(stdout)
        ? ({ provider: PROVIDER, available: true, fix: null } satisfies ProviderStatus)
        : ({ provider: PROVIDER, available: false, fix: `Runnerbox runs Codex ${SUPPORTED_CODEX_LABEL}; this machine has ${stdout.trim() || "an unknown version"}.` } satisfies ProviderStatus);
    });
    const installed = yield* Effect.cachedWithTTL(installedProbe, "1 minute");
    // `codex login status` exits 0 when a home is signed in. Runnerbox never reads the login itself.
    const failed = (message: string) => new ProviderError({ message });
    const loginProbe = (loginHome: string, own: boolean) =>
      Effect.gen(function* () {
        const ready = yield* installed;
        if (!ready.available) return ready;
        if (!own && !(yield* Effect.promise(() => stat(loginHome).then((info) => info.isDirectory(), () => false))))
          return { provider: PROVIDER, available: false, fix: `There's no Codex home at ${loginHome}. Run \`codex login\` on this machine, or point the account at your Codex home.` } satisfies ProviderStatus;
        const { ok } = yield* run(find() ?? "codex", ["login", "status"], loginHome, own);
        return { provider: PROVIDER, available: ok, fix: ok ? null : own ? SIGN_IN_FIX : OWNER_SIGN_IN_FIX } satisfies ProviderStatus;
      });
    // One cached check per home: Runnerbox's own, and each owner's home an account points at.
    const loginStatuses = new Map<string, Effect.Effect<ProviderStatus>>();
    const status = (account: { readonly home: string | null }) =>
      Effect.suspend(() => {
        const loginHome = account.home ?? home;
        const cached = loginStatuses.get(loginHome);
        if (cached) return cached;
        return Effect.cachedWithTTL(loginProbe(loginHome, account.home === null), "1 minute").pipe(
          Effect.tap((check) => Effect.sync(() => loginStatuses.set(loginHome, check))),
          Effect.flatten,
        );
      });

    // The owner's MCP servers that are on in their config, read by `codex mcp list`, to turn off.
    const ownerServers = (executable: string, loginHome: string) =>
      Effect.gen(function* () {
        // With the turn's own features off, so a plugin's or app's server, which the turn never loads,
        // isn't listed: turning off one Codex won't load leaves an entry with no transport, and it won't start.
        const { ok, stdout } = yield* run(executable, ["mcp", "list", "--json", ...DISABLED_FEATURES.flatMap((feature) => ["--disable", feature])], loginHome, false);
        const servers = decodeServerList(stdout);
        if (!ok || servers._tag === "None") return yield* failed("Couldn't read which MCP servers your Codex config has, so Codex wasn't started.");
        const on = servers.value.filter((server) => server.enabled).map((server) => server.name);
        if (on.includes(SERVER_NAME)) return yield* failed(`Your Codex config has an MCP server named \`${SERVER_NAME}\`. Rename it to run this account on your Codex login.`);
        return on;
      });

    const listed = Effect.gen(function* () {
      const executable = find();
      if (executable === null) return [];
      const { ok, stdout } = yield* run(executable, ["debug", "models"], home, true);
      const catalog = Schema.decodeUnknownOption(Catalog)(stdout);
      if (!ok || catalog._tag === "None") return [];
      return HARNESSES.codex.models.filter((model) => catalog.value.models.some((each) => each.slug === model.id && each.visibility !== "hide"));
    });
    const models = yield* Effect.cachedWithTTL(listed, "10 minutes");

    const runTurn = (input: TurnInput) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const executable = find();
          if (executable === null) return yield* failed(INSTALL_FIX);
          const ready = yield* installed;
          if (!ready.available) return yield* failed(ready.fix ?? INSTALL_FIX);
          // The owner's home when the account uses their login, with their MCP servers turned off.
          const loginHome = input.account.home ?? home;
          const servers = input.account.home === null ? [] : yield* ownerServers(executable, loginHome);
          const turn = { mcpUrl: input.mcp.url, propose: input.propose, reproduce: input.reproduce, ownerServers: servers };
          const args = appServerArgs(turn);
          const thread = threadStartParams({ cwd, systemPrompt: input.systemPrompt, model: input.account.model ?? undefined });
          const problems = launchProblems(turn, args, thread);
          if (problems.length > 0) return yield* failed(`Runnerbox didn't start Codex: it would have run without ${problems.join(", ")}.`);
          yield* Effect.tryPromise({ try: () => mkdir(cwd, { recursive: true, mode: 0o700 }), catch: () => failed("Couldn't make the turn's working directory on the server.") });
          // Its own process group, so ending the turn ends everything Codex started.
          const child = yield* Effect.acquireRelease(
            Effect.sync(() =>
              spawn(executable, args, {
                cwd,
                // No key, whatever the account holds: Codex runs on a sign-in in its home, never a key.
                env: { ...codexEnv(process.env, loginHome), [TOKEN_ENV]: input.mcp.token },
                stdio: ["pipe", "pipe", "pipe"],
                detached: true,
              }),
            ),
            (process) => Effect.promise(() => killGroup(process)),
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
      let threadId = "";
      // Answers to Runnerbox's own four requests: initialize, thread/start, the MCP servers' status,
      // then turn/start. The question is sent only once Codex says what it applied and which
      // servers are on, and both are as Runnerbox set them.
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
          threadId = started.value.thread.id;
          send({ id: 3, method: "mcpServerStatus/list", params: { threadId, limit: 100 } });
          return Effect.succeed([]);
        }
        if (response.id === 3) {
          const servers = decodeMcpServers(response.result);
          if (servers._tag === "None") return Effect.fail(failed("Codex listed its MCP servers in a way Runnerbox couldn't read."));
          const problems = mcpProblems(servers.value, allowedTools(turn));
          if (problems.length > 0) return Effect.fail(failed(`Runnerbox didn't send the question: Codex says ${problems.join(", ")}.`));
          send({ id: 4, method: "turn/start", params: turnStartParams(threadId, input.prompt, input.images) });
          return Effect.succeed([]);
        }
        return response.id === 4 ? Effect.succeed([]) : Effect.fail(failed("Codex answered a request Runnerbox didn't make."));
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
