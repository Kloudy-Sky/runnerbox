import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { ProviderStatus } from "@runnerbox/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ServerPaths from "../../config/ServerPaths.ts";
import { codexEnv, codexHome } from "./codexCommand.ts";
import { HARNESSES } from "./harnesses.ts";
import { CodexProviderAdapter, ProviderError } from "./ProviderAdapter.ts";

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

export const make = Effect.gen(function* () {
  const { serverDir } = yield* ServerPaths.ServerPaths;
  const home = codexHome(serverDir);

  // `codex login status` exits 0 when the home is signed in. Runnerbox never reads the login itself.
  const probe = Effect.gen(function* () {
    const executable = findCodex();
    if (executable === null) return { provider: PROVIDER, available: false, fix: INSTALL_FIX } satisfies ProviderStatus;
    const { ok } = yield* run(executable, ["login", "status"], home);
    return { provider: PROVIDER, available: ok, fix: ok ? null : SIGN_IN_FIX } satisfies ProviderStatus;
  });
  const loginStatus = yield* Effect.cachedWithTTL(probe, "1 minute");
  // An API account needs only the CLI; a login account also needs Runnerbox's home signed in.
  const status = (account: { readonly hasKey: boolean }) =>
    account.hasKey ? Effect.sync((): ProviderStatus => (findCodex() === null ? { provider: PROVIDER, available: false, fix: INSTALL_FIX } : { provider: PROVIDER, available: true, fix: null })) : loginStatus;

  const listed = Effect.gen(function* () {
    const executable = findCodex();
    if (executable === null) return [];
    const { ok, stdout } = yield* run(executable, ["debug", "models"], home);
    const catalog = Schema.decodeUnknownOption(Catalog)(stdout);
    if (!ok || catalog._tag === "None") return [];
    return HARNESSES.codex.models.filter((model) => catalog.value.models.some((each) => each.slug === model.id && each.visibility !== "hide"));
  });
  const models = yield* Effect.cachedWithTTL(listed, "10 minutes");

  // Turns come with the adapter's tool check; until then a Codex account can be set up, not used.
  const runTurn = () => Stream.fail(new ProviderError({ message: "This server can't run Codex turns yet." }));

  return CodexProviderAdapter.of({ status, models, runTurn });
});

export const layer = Layer.effect(CodexProviderAdapter, make);
