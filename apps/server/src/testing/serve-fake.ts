// Serves fixture logs with a scripted agent, for driving the app's threads by hand without a
// Claude login:
//   node apps/server/src/testing/serve-fake.ts <empty dir> [--port 4517] [--no-provider]
// It writes fixtures under <dir>, prints a pairing code, and runs until stopped. Never point it
// at a real state directory. Keep <dir> short: the reproduce socket's path must fit in about
// 100 characters.
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ALL_SCOPES } from "@runnerbox/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as AuthStore from "../auth/AuthStore.ts";
import { layerApp } from "../server.ts";
import { makeFakeProvider } from "./FakeProvider.ts";
import { startFakeUp } from "./fakeUp.ts";
import { LINUX_IMAGE, writeFixtures } from "./fixtures.ts";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { port: { type: "string", default: "4517" }, "no-provider": { type: "boolean", default: false } } });
const target = positionals[0];
if (!target) {
  console.error("Usage: node apps/server/src/testing/serve-fake.ts <empty dir> [--port 4517] [--no-provider]");
  process.exit(2);
}
const stateDir = join(resolve(target), "runnerbox");
await writeFixtures(stateDir, Date.now());

const fake = makeFakeProvider({
  available: !values["no-provider"],
  delayMs: 120,
  turns: [
    [
      { text: "Checking the samples and launcher events around that attempt." },
      { tool: "machine_samples", input: { days: 7, maxPoints: 200 } },
      { tool: "launcher_events", input: { days: 7 } },
      {
        text: "Confirmed: the machine. The VM's available memory fell to about a tenth of its total during the failed attempt, and its runner's container exited 137, the kernel's out-of-memory kill. The retry on the same commit passed with plenty free.\n\nGive the VM more memory, or raise memoryFloor.vmMiB to at least one job's memoryReservation so a second job can't start while it's short. Press Reproduce if you want me to rerun the test step on its own.",
      },
    ],
    [
      { text: "Installing dependencies, then rerunning the test step." },
      { tool: "repro_exec", input: { command: "pnpm install --frozen-lockfile", timeoutSec: 300 } },
      { tool: "repro_exec", input: { command: "pnpm test", timeoutSec: 600 } },
      { text: "The test step passes in the container: 214 tests in 3 minutes, close to its typical time. With room in the VM the code is fine, so it was the machine running short of memory." },
    ],
    [{ text: "Looking at which steps grew. The test step took most of the extra time, " }, { hang: true }],
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

const program = Effect.gen(function* () {
  const context = yield* Layer.build(layerApp({ host: "127.0.0.1", port: Number(values.port), tunnelPort: null, stateDir, label: "example", provider: fake.layer }));
  const { code } = yield* Context.get(context, AuthStore.AuthStore).createPairingCode(ALL_SCOPES);
  console.log(`Serving fixtures from ${stateDir} on http://127.0.0.1:${values.port}. Pairing code: ${code}`);
  return yield* Effect.never;
});
Effect.runFork(Effect.scoped(program));
