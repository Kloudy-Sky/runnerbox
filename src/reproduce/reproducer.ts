import type { Readable } from "node:stream";
import type { RunnerType } from "../launcher/launcher-config.ts";
import type { VmExec } from "../vm/exec-in-vm.ts";
import { execCommand, imageExistsCommand, networkOffCommand, removeCommand, reproduceRunCommand, sweepCommand, unpackCommand } from "./container-command.ts";
import type { Executed, ReproduceRequest, Started, Stopped } from "./protocol.ts";

// One throwaway container at a time per install, on a kind's image with a commit's files, for
// `runnerbox serve` to rerun a failing step in. It yields to real jobs: it starts only while no
// slot waits for memory and there's room above the kind's floor for its memory limit, and it's
// removed as soon as a slot has to wait. It's also removed when idle, when old, or on request.

export const IDLE_MS = 5 * 60_000;
export const MAX_AGE_MS = 30 * 60_000;
export const MAX_COMMANDS = 40;
export const CHECK_MS = 30_000;
const OUTPUT_BYTES = 16 * 1024;
const QUICK_MS = 60_000;
const UNPACK_MS = 5 * 60_000;

export type ReproducerActions = {
  install: string;
  runners: ReadonlyArray<RunnerType>;
  // Job VMs aren't supported yet: a reproduce shares the VM jobs run in.
  jobVms: boolean;
  // The tag the kind's new containers use, or null before its image is ready.
  currentImage: (kind: string) => string | null;
  vm: (command: string, options: { input?: string | Readable; timeoutMs: number; maxOutput: number }) => Promise<VmExec>;
  // Fails with a plain message when the token is missing, is the minting token, can't read the
  // repository, or the repository is public.
  source: (repo: string, commit: string) => Promise<Readable>;
  // Why the kind's memory limit doesn't fit above its floor right now, or null when it does.
  roomFor: (runner: RunnerType) => Promise<string | null>;
  slotsWaiting: () => number;
  every: (ms: number, check: () => Promise<void>) => () => void;
  now: () => number;
  newId: () => string;
  log: (message: string) => void;
};

type Session = { id: string; kind: string; startedAt: number; usedAt: number; commands: number; cutNetwork: boolean; busy: boolean };

export class ReproduceRefused extends Error {}

export function createReproducer(actions: ReproducerActions) {
  const { install, vm, now, log } = actions;
  let session: Session | null = null;
  // Why the last reproduce ended, so its next command can say so rather than "no such reproduce".
  let ended: { id: string; reason: string } | null = null;
  let starting = false;

  const remove = async (current: Session, reason: string) => {
    if (session === current) session = null;
    ended = { id: current.id, reason };
    log(`reproduce ${current.id}: removed, ${reason}`);
    await vm(removeCommand(install, current.id), { timeoutMs: QUICK_MS, maxOutput: 1024 });
  };

  async function start(request: Extract<ReproduceRequest, { op: "start" }>): Promise<Started> {
    if (actions.jobVms) throw new ReproduceRefused("Reproduce doesn't run on an install with jobVms yet.");
    if (session || starting) throw new ReproduceRefused("A reproduce is already running on this install. Stop it first.");
    const runner = actions.runners.find((candidate) => candidate.name === request.kind);
    if (!runner) throw new ReproduceRefused(`This install has no runner kind named ${request.kind}.`);
    if (actions.slotsWaiting() > 0) throw new ReproduceRefused("Real jobs are waiting for memory, so a reproduce can't start now.");
    const short = await actions.roomFor(runner);
    if (short) throw new ReproduceRefused(`Not enough memory for a reproduce: ${short}.`);
    const current = actions.currentImage(runner.name);
    if (!current) throw new ReproduceRefused(`${runner.name}'s image isn't ready yet.`);
    starting = true;
    try {
      const requested = request.image && request.image !== current && (await vm(imageExistsCommand(request.image), { timeoutMs: QUICK_MS, maxOutput: 1024 })).exitCode === 0;
      const image = requested ? request.image! : current;
      const tarball = await actions.source(request.repo, request.commit).catch((error: unknown) => {
        throw new ReproduceRefused(error instanceof Error ? error.message : String(error));
      });
      const id = actions.newId();
      const fail = async (what: string, result: VmExec) => {
        await vm(removeCommand(install, id), { timeoutMs: QUICK_MS, maxOutput: 1024 });
        tarball.destroy();
        throw new ReproduceRefused(`${what}: ${result.output.trim().split("\n").at(-1) ?? `exit ${result.exitCode}`}`);
      };
      const ran = await vm(reproduceRunCommand(install, runner, id, image), { timeoutMs: QUICK_MS, maxOutput: 4096 });
      if (ran.exitCode !== 0) return await fail("The container didn't start", ran);
      const unpacked = await vm(unpackCommand(install, id), { input: tarball, timeoutMs: UNPACK_MS, maxOutput: 4096 });
      if (unpacked.exitCode !== 0) return await fail("The commit's files didn't unpack", unpacked);
      const at = now();
      session = { id, kind: runner.name, startedAt: at, usedAt: at, commands: 0, cutNetwork: request.network === "setup", busy: false };
      log(`reproduce ${id}: started on ${image} with ${request.repo} at ${request.commit.slice(0, 7)}`);
      return { id, image, imageFallback: request.image !== undefined && image !== request.image };
    } finally {
      starting = false;
    }
  }

  const own = (id: string) => {
    if (session?.id === id) return session;
    throw new ReproduceRefused(ended?.id === id ? `This reproduce ended: ${ended.reason}.` : "No reproduce has that id.");
  };

  async function exec(request: Extract<ReproduceRequest, { op: "exec" }>): Promise<Executed> {
    const current = own(request.id);
    if (current.busy) throw new ReproduceRefused("A command is already running in this reproduce.");
    if (current.commands >= MAX_COMMANDS) throw new ReproduceRefused(`This reproduce has run its ${MAX_COMMANDS} commands.`);
    current.busy = true;
    current.commands += 1;
    try {
      // A little past the command's own timeout, which kills it inside the container first.
      const result = await vm(execCommand(install, current.id, request.timeoutSec), {
        input: request.command,
        timeoutMs: (request.timeoutSec + 30) * 1000,
        maxOutput: OUTPUT_BYTES,
      });
      if (current.cutNetwork && session === current) {
        current.cutNetwork = false;
        await vm(networkOffCommand(install, current.id), { timeoutMs: QUICK_MS, maxOutput: 1024 });
      }
      current.usedAt = now();
      return { ...result, timedOut: result.timedOut || result.exitCode === 124, commandsLeft: MAX_COMMANDS - current.commands };
    } finally {
      current.busy = false;
    }
  }

  async function stop(id: string): Promise<Stopped> {
    await remove(own(id), "stopped");
    return { stopped: true };
  }

  // Real jobs come first, and nothing outlives its lease.
  const check = async () => {
    const current = session;
    if (!current) return;
    const at = now();
    if (actions.slotsWaiting() > 0) await remove(current, "real jobs needed the memory");
    else if (at - current.startedAt > MAX_AGE_MS) await remove(current, "it reached 30 minutes");
    else if (!current.busy && at - current.usedAt > IDLE_MS) await remove(current, "it was idle for 5 minutes");
  };

  return {
    start,
    exec,
    stop,
    check,
    // Removes whatever an earlier `up` left, then keeps checking leases until stopped.
    async begin() {
      await vm(sweepCommand(install), { timeoutMs: QUICK_MS, maxOutput: 1024 });
      return actions.every(CHECK_MS, check);
    },
    async end() {
      if (session) await remove(session, "up stopped");
    },
  };
}

export type Reproducer = ReturnType<typeof createReproducer>;
