import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Supervisor, type UpdateStep } from "../Supervisor.ts";

// A supervisor with short timings, for tests that run it as its own process and kill it:
//   node harness.ts <runnerbox.js> <step to stop at, or -> serve ...
// It writes `step-<name>` beside the file as it passes each step, and at the named one waits
// forever, so the test can kill it there.
const [file = "", pauseAt = "-", ...args] = process.argv.slice(2);
const supervisor = new Supervisor({
  node: process.execPath,
  nodeArgs: [],
  file,
  args,
  env: process.env,
  stopGraceMs: 500,
  handoffMs: 50,
  preflightTimeoutMs: 2_000,
  trialTimeoutMs: Number(process.env.TRIAL_TIMEOUT_MS ?? 3_000),
  onStep: async (step: UpdateStep) => {
    writeFileSync(join(dirname(file), `step-${step}`), "");
    if (step === pauseAt) await new Promise(() => undefined);
  },
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => supervisor.stop(signal));
process.exit(await supervisor.run());
