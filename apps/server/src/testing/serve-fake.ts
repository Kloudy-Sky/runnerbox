// Serves fixture logs with a scripted agent, for driving the app's threads by hand without a
// Claude login:
//   node apps/server/src/testing/serve-fake.ts <empty dir> [--port 4517] [--no-provider]
// It writes fixtures under <dir>, prints a pairing code, and runs until stopped. Never point it
// at a real state directory.
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ALL_SCOPES } from "@runnerbox/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as AuthStore from "../auth/AuthStore.ts";
import { layerApp } from "../server.ts";
import { makeFakeProvider } from "./FakeProvider.ts";
import { writeFixtures } from "./fixtures.ts";

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
        text: "Confirmed: infra. The VM's available memory fell to about a tenth of its total during the failed attempt, and its runner's container exited 137, the kernel's out-of-memory kill. The retry on the same commit passed with plenty free.\n\nGive the VM more memory, or raise memoryFloor.vmMiB to at least one job's memoryReservation so a second job can't start while it's short.",
      },
    ],
    [{ text: "Looking at which steps grew. The test step took most of the extra time, " }, { hang: true }],
  ],
});

const program = Effect.gen(function* () {
  const context = yield* Layer.build(layerApp({ host: "127.0.0.1", port: Number(values.port), tunnelPort: null, stateDir, label: "example", provider: fake.layer }));
  const { code } = yield* Context.get(context, AuthStore.AuthStore).createPairingCode(ALL_SCOPES);
  console.log(`Serving fixtures from ${stateDir} on http://127.0.0.1:${values.port}. Pairing code: ${code}`);
  return yield* Effect.never;
});
Effect.runFork(Effect.scoped(program));
