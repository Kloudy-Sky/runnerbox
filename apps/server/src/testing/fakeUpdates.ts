import { createHash, generateKeyPairSync } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createChanges } from "runnerbox/src/changes/changes.ts";
import { listenForControl } from "runnerbox/src/control/socket.ts";
import { createServer } from "node:http";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import packageJson from "../../package.json" with { type: "json" };
import { createSlotState } from "runnerbox/src/launcher/slot-state.ts";
import type { UpdateWiring } from "../server.ts";
import * as Supervision from "../update/Supervision.ts";
import { newUpdateId, type UpdateRecord, updatePaths, writeRecord } from "../update/supervisor/updateFiles.ts";

const EXAMPLE_CONFIG = fileURLToPath(new URL("../../../../runnerbox.example.json", import.meta.url));

// A release of about 10 MB, sent slowly enough to watch the download move.
const RELEASE = Buffer.alloc(10 * 1024 * 1024, "// runnerbox.js\n");
const CHUNKS = 40;
const CHUNK_MS = 150;

// For serve-fake's `--updates commit|rollback`: an update the app can run end to end against
// fixtures. Releases come from a local server, and a stand-in supervisor records the update, asks
// for the restart, and records how it ended: put in place, or the new version not starting. It
// also keeps a container install and a host install live, both started before any update, so
// About lists them as still on the old version.
// `unsigned` trusts a throwaway signing key and serves a release with no signature, as a release
// made by pushing a tag is, so the app says it can't be installed from here.
export async function fakeUpdates(dir: string, stateDir: string, outcome: "commit" | "rollback" | "unsigned", restart: () => void): Promise<UpdateWiring> {
  const file = join(dir, "runnerbox.js");
  await mkdir(dir, { recursive: true });
  await writeFile(file, "// runnerbox.js, as installed\n");
  const sha256 = createHash("sha256").update(RELEASE).digest("hex");
  const server = createServer((request, response) => {
    if (request.url?.endsWith("/runnerbox.js.sha256")) return void response.end(`${sha256}  runnerbox.js\n`);
    if (!request.url?.endsWith("/runnerbox.js")) return void response.writeHead(404).end();
    response.writeHead(200, { "content-length": RELEASE.length });
    const size = Math.ceil(RELEASE.length / CHUNKS);
    let sent = 0;
    const timer = setInterval(() => {
      response.write(RELEASE.subarray(sent, sent + size));
      sent += size;
      if (sent >= RELEASE.length) {
        clearInterval(timer);
        response.end();
      }
    }, CHUNK_MS);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  // `ci` takes restarts through a real control socket: busy for 15 seconds after the owner asks,
  // then restarted. `build` takes them too, and its last one gave up after 6 hours. `mac` runs
  // jobs on the machine's own OS.
  const live = new Map<string, ReturnType<typeof createSlotState>>();
  const start = async (install: string, runsIn: "container" | "host") => {
    await mkdir(join(stateDir, install), { recursive: true });
    const state = createSlotState(join(stateDir, install, "state.json"), install, [{ name: "linux", label: `${install}-linux`, slots: 1, runsIn }]);
    live.set(install, state);
    await state.flush();
  };
  for (const [install, runsIn] of [["ci", "container"], ["build", "container"], ["mac", "host"]] as const) await start(install, runsIn);
  setInterval(() => live.forEach((state) => void state.flush()), 10_000).unref();
  // As though the owner had asked `build` to restart right after the update, 6 hours ago.
  const buildGaveUp = () =>
    appendFile(join(stateDir, "build", "changes.ndjson"), `${JSON.stringify({ time: new Date().toISOString(), kind: "restart", outcome: "not_restarted", requestedBy: { session: "fake", label: "desktop" }, reason: "no moment without a running job came in 6 hours" })}\n`);
  for (const install of ["ci", "build"]) {
    const installDir = join(stateDir, install);
    const configPath = join(installDir, `${install}.json`);
    await writeFile(configPath, `${JSON.stringify({ ...JSON.parse(await readFile(EXAMPLE_CONFIG, "utf8")), changes: true }, null, 2)}\n`, { mode: 0o600 });
    let askedAt: number | null = null;
    const changes = createChanges({
      configPath,
      logPath: join(installDir, "changes.ndjson"),
      machine: async () => ({ hostMiB: 32_768, vmMiB: 16_384, vmCpus: 8 }),
      busy: async () => {
        askedAt ??= Date.now();
        return Date.now() - askedAt < 15_000;
      },
      // A drain ends with the service manager starting it again.
      drain: () => void setTimeout(() => void start(install, "container"), 1_000),
      every: (ms, check) => {
        const timer = setInterval(() => void check(), Math.min(ms, 2_000));
        return () => clearInterval(timer);
      },
      now: Date.now,
      log: () => {},
    });
    changes.begin();
    await listenForControl(installDir, { reproducer: null, changes });
  }

  const supervision = Supervision.layerTest({ protocol: 1, file, role: "active" }, ({ version }) =>
    Effect.promise(async () => {
      // As long as checking that a download runs takes.
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const record: UpdateRecord = { id: newUpdateId(), from: packageJson.version, to: version, sha256, status: "pending", startedAt: new Date().toISOString() };
      await writeRecord(updatePaths(file).record, record);
      // The old server stops, then the outcome is recorded while it's down, as the supervisor
      // records it only once the new version is listening or the old one is back.
      setTimeout(() => {
        restart();
        setTimeout(() => {
          const finished = { ...record, finishedAt: new Date().toISOString() };
          void writeRecord(updatePaths(file).record, outcome === "commit" ? { ...finished, status: "committed" } : { ...finished, status: "rolled-back", reason: "It wasn't ready within 60 seconds." }).then(() =>
            setTimeout(() => void buildGaveUp(), 500),
          );
        }, 500);
      }, 2_000);
      return record.id;
    }),
  );
  const keys = outcome === "unsigned" ? [{ id: "fake", publicKey: generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString() }] : [];
  return {
    keys,
    source: { releaseUrl: (version) => `http://127.0.0.1:${port}/v${version}/`, redirectAllowed: (url) => url.host === `127.0.0.1:${port}` },
    supervision,
  };
}
