// Serves fixture logs with a scripted agent, for driving the app's threads by hand without a
// Claude login:
//   node apps/server/src/testing/serve-fake.ts <empty dir> [--port 4517] [--no-provider] [--older] [--codex] [--updates commit|rollback] [--runners <case>]
// `--older` answers as a server from before the composer's model menu, attachments, references,
// queue and delete, to see the app hold back what such a server can't do. `--codex` runs the real
// Codex adapter beside the scripted Claude one, with a Codex home under <dir>, signed in with
// `XDG_STATE_HOME=<dir> runnerbox codex-login`; it reaches the machine's `codex`, not the fixtures.
// `--updates` lets the app update it from a local release, ending as the flag says, and restarts
// it on the same port for that (fakeUpdates.ts). Stamp apps/server's version below the app's to
// see the app offer it.
// `--runners` puts the install in one of the Runners page's cases: busy, quiet, failing,
// rebuilding or no-samples.
// It writes fixtures under <dir>, prints a pairing code, and runs until stopped. Never point it
// at a real state directory. Keep <dir> short: the reproduce socket's path must fit in about
// 100 characters.
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ALL_SCOPES } from "@runnerbox/contracts";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as AuthStore from "../auth/AuthStore.ts";
import * as QueueConfig from "../runners/QueueConfig.ts";
import { layerApp } from "../server.ts";
import * as CodexAdapter from "../threads/provider/CodexAdapter.ts";
import { makeFakeProvider } from "./FakeProvider.ts";
import { fakeUpdates } from "./fakeUpdates.ts";
import { startFakeUp } from "./fakeUp.ts";
import { startFakeGitHub } from "./fakeGitHub.ts";
import { LINUX_IMAGE, writeFixtures } from "./fixtures.ts";
import { RUNNER_SCENARIOS, writeRunnerScenario } from "./runnerScenarios.ts";


const { values, positionals } = parseArgs({ allowPositionals: true, options: { port: { type: "string", default: "4517" }, "no-provider": { type: "boolean", default: false }, older: { type: "boolean", default: false }, codex: { type: "boolean", default: false }, updates: { type: "string" }, runners: { type: "string" } } });
// What a server from before the composer work doesn't answer.
const OLDER_SERVER_LACKS = [
  "server.methods",
  "threads.harnesses",
  "threads.delete",
  "threads.stageAttachment",
  "threads.attachmentChunk",
  "threads.discardAttachment",
  "threads.attachment",
  "threads.queueTurn",
  "threads.cancelQueued",
] as const;
const target = positionals[0];
if (!target) {
  console.error("Usage: node apps/server/src/testing/serve-fake.ts <empty dir> [--port 4517] [--no-provider] [--older] [--codex]");
  process.exit(2);
}
const stateDir = join(resolve(target), "runnerbox");
await writeFixtures(stateDir, Date.now());
const scenario = RUNNER_SCENARIOS.find((name) => name === values.runners);
if (values.runners !== undefined && !scenario) {
  console.error(`--runners is one of ${RUNNER_SCENARIOS.join(", ")}.`);
  process.exit(2);
}
// Its state is rewritten like a running `up`'s, so it never reads as stale.
if (scenario) setInterval((await writeRunnerScenario(stateDir, Date.now(), scenario)).heartbeat, 10_000);
// Its queue poll asks a local stand-in for GitHub, with a made-up token in a file beside the
// fixtures, and never reads a real report.env or reaches GitHub.
const fakeGitHub = await startFakeGitHub(Date.now());
const fakeReportEnv = join(resolve(target), "report.env");
await writeFile(fakeReportEnv, "GITHUB_TOKEN=not-a-real-token\n", { mode: 0o600 });
const FAKE_GITHUB = { apiBase: fakeGitHub.apiBase, reportEnvPath: fakeReportEnv, timing: { pollMs: 20_000, slowMs: 120_000, maxBackoffMs: 300_000, idleMs: 60_000, checkMs: 1_000 } };

const fake = makeFakeProvider({
  available: !values["no-provider"],
  delayMs: 120,
  monitor: {
    costUsd: 0.006,
    steps: [
      { tool: "machine_samples", input: { days: 7, maxPoints: 200 } },
      { tool: "launcher_events", input: { days: 7 } },
      { text: "The machine, not the code. The VM's memory fell to about a tenth while two jobs ran, and the job's container was stopped for it. Raising the VM's memory floor would make a second job wait for room. Ask me here to propose it if you want that." },
    ],
  },
  turns: [
    [
      { text: "Checking the samples and launcher events around that attempt." },
      { tool: "machine_samples", input: { days: 7, maxPoints: 200 } },
      { tool: "launcher_events", input: { days: 7 } },
      { tool: "install_settings", input: { install: "example" } },
      {
        tool: "propose_change",
        input: {
          install: "example",
          changes: [{ path: "memoryFloor.vmMiB", to: 4000 }],
          reason: "The VM fell to a tenth of its memory while two jobs ran, and the test container was killed for it. A floor of 4000 MiB keeps a second job from starting until there's room.",
        },
      },
      {
        // Markdown, as answers are shown: a list, code, a GitHub link and one the app shows as text.
        text: "Confirmed: the machine.\n\n- The VM's available memory fell to about a tenth of its total during the failed attempt.\n- Its runner's container exited `137`, the kernel's out-of-memory kill.\n- The retry on the same commit [passed](https://github.com/owner/name/actions/runs/5217) with plenty free.\n\nI proposed raising `memoryFloor.vmMiB` from 1500 to 4000 MiB, so a second job waits until there's room. It changes nothing until you approve it. More on exit 137 [here](https://example.com/oom). Press Reproduce if you want me to rerun the test step on its own.",
      },
    ],
    [
      { text: "Installing dependencies, then rerunning the test step." },
      { tool: "repro_exec", input: { command: "pnpm install --frozen-lockfile", timeoutSec: 300 } },
      { tool: "repro_exec", input: { command: "pnpm test", timeoutSec: 600 } },
      { text: "The test step passes in the container: 214 tests in 3 minutes, close to its typical time. With room in the VM the code is fine, so it was the machine running short of memory." },
    ],
    [{ text: "Looking at which steps grew. The test step took most of the extra time, " }, { hang: true }],
    [{ tool: "list_runs", input: { repo: "owner/name", days: 7 } }, { fail: "The provider stopped answering." }],
  ],
});

// `up`'s reproduce socket for the fixtures' install, over a pretend VM.
await startFakeUp(join(stateDir, "example"), {
  currentImage: LINUX_IMAGE,
  run: (command) =>
    command.startsWith("pnpm install")
      ? { exitCode: 0, output: "Lockfile is up to date, resolution step is skipped\nPackages: +612\nDone in 9.4s\n" }
      : { exitCode: 0, output: " Test Files  38 passed (38)\n      Tests  214 passed (214)\n   Duration  3m 02s\n" },
});

// Set by an update the app runs, to stop the server and start it again.
let restart = Deferred.makeUnsafe<void>();
if (values.updates !== undefined && values.updates !== "commit" && values.updates !== "rollback") throw new Error("--updates is commit or rollback.");
const updates = values.updates ? await fakeUpdates(join(resolve(target), "install"), stateDir, values.updates, () => Deferred.doneUnsafe(restart, Exit.void)) : undefined;

const serve = (first: boolean) =>
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(
        layerApp({ host: "127.0.0.1", port: Number(values.port), tunnelPort: null, stateDir, label: "example", provider: fake.layer, ...(values.codex ? { codex: CodexAdapter.layer } : {}), withoutMethods: values.older ? OLDER_SERVER_LACKS : [], queue: QueueConfig.layerTest(FAKE_GITHUB), ...(updates ? { updates } : {}) }),
      );
      if (first) {
        const { code } = yield* Context.get(context, AuthStore.AuthStore).createPairingCode(ALL_SCOPES);
        console.log(`Serving fixtures from ${stateDir} on http://127.0.0.1:${values.port}. Pairing code: ${code}`);
      } else console.log("Restarted after an update.");
      yield* Deferred.await(restart);
    }),
  );

const program = Effect.gen(function* () {
  for (let first = true; ; first = false) {
    yield* serve(first);
    restart = Deferred.makeUnsafe<void>();
    // A real restart takes a moment, long enough for the app to see the socket go.
    yield* Effect.sleep("1500 millis");
  }
});
Effect.runFork(program);
