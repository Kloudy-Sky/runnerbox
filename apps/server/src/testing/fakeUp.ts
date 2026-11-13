import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { loadLauncherConfig } from "runnerbox/src/launcher/launcher-config.ts";
import type { ReproduceRequest } from "runnerbox/src/reproduce/protocol.ts";
import { createReproducer } from "runnerbox/src/reproduce/reproducer.ts";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createChanges } from "runnerbox/src/changes/changes.ts";
import { listenForControl } from "runnerbox/src/control/socket.ts";

const EXAMPLE_CONFIG = fileURLToPath(new URL("../../../../runnerbox.example.json", import.meta.url));

// `up`'s real control socket, reproduce lifecycle and change logic for one install, over a pretend
// VM: no SSH, docker or GitHub. `run` answers each command the agent sends. `requests` is what
// reached the socket. The install's config is a copy of the example with `changes` on, at
// `configPath`, and its change log is beside the other install logs, where `serve` reads it.
export async function startFakeUp(
  installStateDir: string,
  options: { readonly run?: (command: string) => { exitCode: number; output: string }; readonly currentImage?: string; readonly imageInVm?: (tag: string) => boolean } = {},
) {
  const config = await loadLauncherConfig(EXAMPLE_CONFIG);
  const configPath = join(installStateDir, "example.json");
  await writeFile(configPath, `${JSON.stringify({ ...JSON.parse(await readFile(EXAMPLE_CONFIG, "utf8")), changes: true }, null, 2)}\n`, { mode: 0o600 });
  const drains: string[] = [];
  const changes = createChanges({
    configPath,
    logPath: join(installStateDir, "changes.ndjson"),
    machine: async () => ({ hostMiB: 32_768, vmMiB: 16_384, vmCpus: 8 }),
    busy: async () => false,
    drain: (why) => void drains.push(why),
    every: () => () => {},
    now: Date.now,
    log: () => {},
  });
  const requests: ReproduceRequest[] = [];
  let ids = 0;
  const reproducer = createReproducer({
    install: config.name,
    runners: "vm" in config ? config.runners : [],
    jobVms: false,
    currentImage: () => options.currentImage ?? "app-ci:current",
    vm: async (command, { input }) => {
      // An image check asks whether a tag is still in the VM.
      const tag = /^docker image inspect '([^']+)'/.exec(command)?.[1];
      if (tag !== undefined) return { exitCode: options.imageInVm?.(tag) === false ? 1 : 0, output: "", truncated: false, timedOut: false };
      const ran = typeof input === "string" ? (options.run?.(input) ?? { exitCode: 0, output: "" }) : { exitCode: 0, output: "" };
      return { ...ran, truncated: false, timedOut: false };
    },
    source: async () => Readable.from(["tar"]),
    roomFor: async () => null,
    slotsWaiting: () => 0,
    every: () => () => {},
    now: Date.now,
    newId: () => (ids++).toString(16).padStart(8, "0"),
    log: () => {},
  });
  const recorded = {
    ...reproducer,
    start: (request: Extract<ReproduceRequest, { op: "start" }>) => (requests.push(request), reproducer.start(request)),
    exec: (request: Extract<ReproduceRequest, { op: "exec" }>) => (requests.push(request), reproducer.exec(request)),
  };
  const control = await listenForControl(installStateDir, { reproducer: recorded, changes });
  const readConfig = async () => JSON.parse(await readFile(configPath, "utf8"));
  return { requests, reproducer, changes, configPath, readConfig, drains, close: async () => control.close() };
}
