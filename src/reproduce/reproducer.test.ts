import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { test } from "node:test";
import { loadLauncherConfig, type RunnerType } from "../launcher/launcher-config.ts";
import { createReproducer, IDLE_MS, MAX_AGE_MS, MAX_COMMANDS, type ReproducerActions } from "./reproducer.ts";

const COMMIT = "a".repeat(40);
const start = { op: "start", repo: "owner/name", commit: COMMIT, kind: "linux", network: "on" } as const;

async function fakes(overrides: Partial<ReproducerActions> = {}) {
  const config = await loadLauncherConfig("runnerbox.example.json");
  const runners: RunnerType[] = "vm" in config ? config.runners : [];
  const vmCalls: { command: string; input: string | null }[] = [];
  const clock = { now: 1_700_000_000_000 };
  const state = { slotsWaiting: 0, room: null as string | null, sourceError: null as string | null };
  const actions: ReproducerActions = {
    install: "example",
    runners,
    jobVms: false,
    currentImage: () => "runnerbox-base",
    vm: async (command, { input }) => {
      vmCalls.push({ command, input: typeof input === "string" ? input : input ? "<tarball>" : null });
      return { exitCode: 0, output: "done\n", truncated: false, timedOut: false };
    },
    source: async () => {
      if (state.sourceError) throw new Error(state.sourceError);
      return Readable.from(["tar"]);
    },
    roomFor: async () => state.room,
    slotsWaiting: () => state.slotsWaiting,
    every: () => () => {},
    now: () => clock.now,
    newId: () => "0a1b2c3d",
    log: () => {},
    ...overrides,
  };
  return { reproducer: createReproducer(actions), vmCalls, clock, state, kind: runners[0]!.name };
}

test("a reproduce starts on the kind's image with the commit's files, and a command goes in as data", async () => {
  const { reproducer, vmCalls, kind } = await fakes();
  const started = await reproducer.start({ ...start, kind });
  assert.deepEqual(started, { id: "0a1b2c3d", image: "runnerbox-base", imageFallback: false });
  assert.match(vmCalls[0]!.command, /docker run -d --rm --name 'example-repro-0a1b2c3d'/);
  // /work goes to the image's own user before the files land in it.
  assert.match(vmCalls[1]!.command, /docker exec -u 0 'example-repro-0a1b2c3d' chown "\$u:\$g" \/work$/);
  assert.deepEqual(vmCalls[2], { command: "exec docker exec -i -w /work 'example-repro-0a1b2c3d' tar -xz --strip-components=1 -f -", input: "<tarball>" });
  const ran = await reproducer.exec({ op: "exec", id: started.id, command: "pnpm test", timeoutSec: 120 });
  assert.equal(ran.exitCode, 0);
  assert.equal(ran.commandsLeft, MAX_COMMANDS - 1);
  assert.equal(vmCalls[3]!.input, "pnpm test");
  assert.ok(!vmCalls[3]!.command.includes("pnpm test"));
  await assert.rejects(reproducer.start({ ...start, kind }), /already running/);
});

test("it refuses to start with job VMs, while slots wait for memory, without room, or without usable source", async () => {
  const withJobVms = await fakes({ jobVms: true });
  await assert.rejects(withJobVms.reproducer.start({ ...start, kind: withJobVms.kind }), /jobVms/);

  const { reproducer, state, vmCalls, kind } = await fakes();
  state.slotsWaiting = 1;
  await assert.rejects(reproducer.start({ ...start, kind }), /Real jobs are waiting for memory/);
  state.slotsWaiting = 0;
  state.room = "the VM has 900 MiB available, below its 4600 MiB floor";
  await assert.rejects(reproducer.start({ ...start, kind }), /Not enough memory for a reproduce: the VM has 900 MiB/);
  state.room = null;
  state.sourceError = "owner/name is public. Reproduce only runs private repositories' code, since it shares the VM with your jobs.";
  await assert.rejects(reproducer.start({ ...start, kind }), /is public/);
  assert.deepEqual(vmCalls, [], "nothing started in the VM");
});

test("a real slot waiting for memory removes the reproduce, and its next command says why", async () => {
  const { reproducer, state, vmCalls, kind } = await fakes();
  const { id } = await reproducer.start({ ...start, kind });
  state.slotsWaiting = 1;
  await reproducer.check();
  assert.equal(vmCalls.at(-1)!.command, "docker rm -f 'example-repro-0a1b2c3d' >/dev/null 2>&1; true");
  await assert.rejects(reproducer.exec({ op: "exec", id, command: "ls", timeoutSec: 10 }), /ended: real jobs needed the memory/);
});

test("an idle or old reproduce is removed, and a stopped one can't be used", async () => {
  const idle = await fakes();
  const first = await idle.reproducer.start({ ...start, kind: idle.kind });
  idle.clock.now += IDLE_MS + 1;
  await idle.reproducer.check();
  await assert.rejects(idle.reproducer.exec({ op: "exec", id: first.id, command: "ls", timeoutSec: 10 }), /idle for 5 minutes/);

  const old = await fakes();
  const second = await old.reproducer.start({ ...start, kind: old.kind });
  for (let elapsed = 0; elapsed <= MAX_AGE_MS; elapsed += IDLE_MS / 2) {
    old.clock.now += IDLE_MS / 2;
    await old.reproducer.exec({ op: "exec", id: second.id, command: "ls", timeoutSec: 10 }).catch(() => {});
    await old.reproducer.check();
  }
  await assert.rejects(old.reproducer.exec({ op: "exec", id: second.id, command: "ls", timeoutSec: 10 }), /reached 30 minutes/);

  const stopped = await fakes();
  const third = await stopped.reproducer.start({ ...start, kind: stopped.kind });
  await stopped.reproducer.stop(third.id);
  await assert.rejects(stopped.reproducer.exec({ op: "exec", id: third.id, command: "ls", timeoutSec: 10 }), /ended: stopped/);
  await assert.rejects(stopped.reproducer.exec({ op: "exec", id: "ffffffff", command: "ls", timeoutSec: 10 }), /No reproduce has that id/);
});

test("commands are capped, setup mode cuts the network after the first, and the sweep runs first", async () => {
  const { reproducer, vmCalls, kind } = await fakes();
  await reproducer.begin();
  assert.match(vmCalls[0]!.command, /label=runnerbox\.reproduce=example/);
  const { id } = await reproducer.start({ ...start, kind, network: "setup" });
  await reproducer.exec({ op: "exec", id, command: "pnpm install", timeoutSec: 600 });
  assert.equal(vmCalls.at(-1)!.command, "exec docker network disconnect bridge 'example-repro-0a1b2c3d'");
  await reproducer.exec({ op: "exec", id, command: "pnpm test", timeoutSec: 600 });
  assert.equal(vmCalls.filter((call) => call.command.includes("network disconnect")).length, 1);
  for (let count = 2; count < MAX_COMMANDS; count += 1) await reproducer.exec({ op: "exec", id, command: "true", timeoutSec: 1 });
  await assert.rejects(reproducer.exec({ op: "exec", id, command: "true", timeoutSec: 1 }), /run its 40 commands/);
});

test("two starts at once run one container, and a drain mid-start leaves none behind", async () => {
  const { reproducer, vmCalls, kind } = await fakes();
  const results = await Promise.allSettled([reproducer.start({ ...start, kind }), reproducer.start({ ...start, kind })]);
  assert.deepEqual(results.map((result) => result.status), ["fulfilled", "rejected"]);
  assert.equal(vmCalls.filter((call) => call.command.includes("docker run")).length, 1);

  // `up` drains while a start is still checking memory: it removes what it made, and sweeps.
  let release = () => {};
  const slow = await fakes({ roomFor: () => new Promise((resolve) => (release = () => resolve(null))) });
  const starting = slow.reproducer.start({ ...start, kind: slow.kind });
  await slow.reproducer.end();
  release();
  await assert.rejects(starting, /up is stopping/);
  assert.match(slow.vmCalls[0]!.command, /label=runnerbox\.reproduce=example/, "drain sweeps every labelled container");
  assert.equal(slow.vmCalls.at(-1)!.command, "docker rm -f 'example-repro-0a1b2c3d' >/dev/null 2>&1; true");
});

test("a setup reproduce whose network can't be cut is removed rather than kept online", async () => {
  const { reproducer, vmCalls, kind } = await fakes({
    vm: async (command) => {
      vmCalls.push({ command, input: null });
      return { exitCode: command.includes("network disconnect") ? 1 : 0, output: "", truncated: false, timedOut: false };
    },
  });
  const { id } = await reproducer.start({ ...start, kind, network: "setup" });
  await assert.rejects(reproducer.exec({ op: "exec", id, command: "pnpm install", timeoutSec: 600 }), /network couldn't be cut/);
  assert.equal(vmCalls.at(-1)!.command, "docker rm -f 'example-repro-0a1b2c3d' >/dev/null 2>&1; true");
  await assert.rejects(reproducer.exec({ op: "exec", id, command: "curl example.com", timeoutSec: 10 }), /ended: its network couldn't be cut/);
});
