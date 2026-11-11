import { execFile, spawn } from "node:child_process";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as CloudLink from "./CloudLink.ts";

// Runs `cloudflared` for a linked environment, so its tunnel hostname reaches this server's
// loopback port. Same pins as T3 Code: the release we test against, and the oldest that accepts
// every flag we pass.
export const CLOUDFLARED_VERSION = "2026.10.4";
export const CLOUDFLARED_MIN_VERSION = "2025.6.1";

// The token travels in the environment, never in argv, so it doesn't show on the process list.
export function connectorCommand(connectorToken: string) {
  return { args: ["tunnel", "--no-autoupdate", "run"], env: { TUNNEL_TOKEN: connectorToken } };
}

// `cloudflared --version` prints "cloudflared version 2026.10.4 (built ...)".
export function parseVersion(output: string) {
  return /cloudflared version (\d+)\.(\d+)\.(\d+)/.exec(output)?.slice(1).map(Number) ?? null;
}

export function atLeast(version: readonly number[], minimum: string) {
  const floor = minimum.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    if ((version[index] ?? 0) !== (floor[index] ?? 0)) return (version[index] ?? 0) > (floor[index] ?? 0);
  }
  return true;
}

// The binary to run: RUNNERBOX_CLOUDFLARED_PATH, or `cloudflared` on PATH. It isn't downloaded for
// you; docs/connect-setup.md says how to install the pinned release.
export const resolveCloudflared = (binary = process.env.RUNNERBOX_CLOUDFLARED_PATH ?? "cloudflared") =>
  new Promise<{ binary: string; version: string }>((resolve, reject) =>
    execFile(binary, ["--version"], { timeout: 10_000 }, (error, stdout) => {
      const version = parseVersion(stdout);
      if (error || !version) return reject(new Error(`cloudflared not found at "${binary}". Install ${CLOUDFLARED_VERSION}, or set RUNNERBOX_CLOUDFLARED_PATH.`));
      if (!atLeast(version, CLOUDFLARED_MIN_VERSION)) return reject(new Error(`cloudflared ${version.join(".")} is older than ${CLOUDFLARED_MIN_VERSION}.`));
      resolve({ binary, version: version.join(".") });
    }),
  );

const BACKOFF_MS = [2_000, 5_000, 15_000, 60_000];
// How often a failing connector may ask the relay whether its tunnel was reclaimed.
const RECOVERY_INTERVAL_MS = 2 * 60_000;

// Registers that this host can replace its tunnel, and replaces it if the relay reclaimed it while
// the host was away. If the relay can't be reached, the stored connector config is used as it is.
export const ensureTunnel = Effect.fn("connector.ensureTunnel")(function* (link: CloudLink.CloudLink["Service"]) {
  const registered = yield* link.registerRecovery.pipe(Effect.timeout("10 seconds"), Effect.option);
  if (registered._tag === "Some" && registered.value.tunnelReleased) {
    yield* Effect.logInfo("Runnerbox Connect: the relay reclaimed this idle tunnel; asking for a replacement.");
    yield* link.replaceTunnel.pipe(Effect.timeout("30 seconds"), Effect.ignore);
  }
  return yield* link.state;
});

// Keeps the connector running while the server does, if this environment is linked.
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const link = yield* CloudLink.CloudLink;
    const linked = yield* link.state.pipe(Effect.orElseSucceed(() => null));
    if (!linked) return;
    const resolved = yield* Effect.tryPromise(() => resolveCloudflared()).pipe(
      Effect.tapError((error) => Effect.logWarning(`Runnerbox Connect is linked but the connector can't start: ${error.cause instanceof Error ? error.cause.message : "unknown"}`)),
      Effect.option,
    );
    if (resolved._tag === "None") return;
    if (resolved.value.version !== CLOUDFLARED_VERSION) yield* Effect.logWarning(`cloudflared ${resolved.value.version} differs from the tested ${CLOUDFLARED_VERSION}.`);
    let state = (yield* ensureTunnel(link).pipe(Effect.orElseSucceed(() => null))) ?? linked;
    let checkedAt = Date.now();
    const runOnce = Effect.callback<number | null>((resume) => {
      const { args, env } = connectorCommand(state.connectorToken);
      const child = spawn(resolved.value.binary, args, { env: { ...process.env, ...env }, stdio: ["ignore", "ignore", "inherit"] });
      child.once("exit", (code) => resume(Effect.succeed(code)));
      child.once("error", () => resume(Effect.succeed(null)));
      return Effect.sync(() => void child.kill());
    });
    yield* Effect.gen(function* () {
      for (let attempt = 0; ; attempt++) {
        const code = yield* runOnce;
        const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!;
        yield* Effect.logWarning(`cloudflared exited (${code ?? "failed to start"}); restarting in ${delay / 1000}s.`);
        yield* Effect.sleep(delay);
        // An exit may mean the relay reclaimed the tunnel; check, but not on every crash.
        if (Date.now() - checkedAt >= RECOVERY_INTERVAL_MS) {
          checkedAt = Date.now();
          state = (yield* ensureTunnel(link).pipe(Effect.orElseSucceed(() => null))) ?? state;
        }
      }
    }).pipe(Effect.forkScoped);
    yield* Effect.logInfo(`Runnerbox Connect: serving ${state.httpBaseUrl} through cloudflared ${resolved.value.version}.`);
  }),
);
