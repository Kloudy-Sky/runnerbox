import { type ChildProcess, spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { constants } from "node:os";
import { lastLine, preflight } from "./preflight.ts";
import { type ChildContext, type ChildMessage, decodeChildMessage, SUPERVISED_ENV, SUPERVISOR_PROTOCOL, type SupervisorMessage } from "./protocol.ts";
import { builtInReleaseKeys } from "./releaseKeys.ts";
import { type ReleaseKey, verifyRelease } from "./signature.ts";
import { keepPrevious, newUpdateId, putInPlace, settle, sha256File, type UpdateRecord, updatePaths, writeRecord } from "./updateFiles.ts";
import { compareVersions, isExactVersion } from "./version.ts";

// The points an update passes, in order, for tests that stop the supervisor at each one.
export type UpdateStep = "accepted" | "old-stopped" | "trial-started" | "previous-kept" | "renamed";

export type SupervisorOptions = {
  // How to run runnerbox.js again: Node, its flags, the file, and the arguments after the file.
  readonly node: string;
  readonly nodeArgs: ReadonlyArray<string>;
  readonly file: string;
  readonly args: ReadonlyArray<string>;
  readonly env: NodeJS.ProcessEnv;
  readonly stopGraceMs?: number;
  readonly handoffMs?: number;
  readonly preflightTimeoutMs?: number;
  readonly trialTimeoutMs?: number;
  // The keys a release must be signed by; this build's own unless a test says otherwise. None
  // asks for no signature.
  readonly releaseKeys?: ReadonlyArray<ReleaseKey>;
  readonly onStep?: (step: UpdateStep) => Promise<void>;
};

// The server only needs a second to close its listeners; anything longer is stuck.
const STOP_GRACE_MS = 10_000;
// Long enough for the accepted reply to reach the app before the server it went through stops.
const HANDOFF_MS = 2_000;
const PREFLIGHT_TIMEOUT_MS = 30_000;
// A server has no migrations to run: it reads files and binds its ports in a second or two.
const TRIAL_TIMEOUT_MS = 60_000;

const STOPPED = "The service was stopped during the update.";

type Role = "active" | "trial";
type Managed = {
  readonly process: ChildProcess;
  role: Role;
  version: string | null;
  stderr: string;
  readonly exited: Promise<number>;
};
type Pending = { readonly record: UpdateRecord; readonly staged: string; readonly trial: Managed; readonly timer: NodeJS.Timeout };

const exitCodeOf = (code: number | null, signal: NodeJS.Signals | null) => code ?? 128 + (signal ? constants.signals[signal] : 0);

// Runs the server as its child and lives exactly as long as it does, so the service manager's
// restart policy still applies. It stays small and imports only Node's own modules: an update
// replaces the server, never the supervisor already in memory, so a bug here is the one thing an
// update can't fix.
//
// An update, when the running server asks for one: check the download's checksum and that it
// runs here, record it as pending, stop the old server, start the download as a trial, and only
// once the trial says every listener is bound, keep a copy of the old file and rename the new one
// over it. A trial that exits, hangs or says the wrong version is killed and the old file starts
// again. `settle` decides a pending record left by a supervisor that died mid-update.
//   const supervisor = new Supervisor(options); process.on("SIGTERM", () => supervisor.stop("SIGTERM"));
//   process.exit(await supervisor.run());
export class Supervisor {
  readonly #options: SupervisorOptions;
  readonly #paths: ReturnType<typeof updatePaths>;
  // The server serving now. During an update's handoff there's briefly none.
  #active: Managed | null = null;
  // Servers being stopped on purpose, whose exit isn't the end.
  readonly #retiring = new Set<Managed>();
  #updating = false;
  #pending: Pending | null = null;
  #stopping = false;
  readonly #abort = new AbortController();
  #finish: (code: number) => void = () => undefined;

  constructor(options: SupervisorOptions) {
    this.#options = options;
    this.#paths = updatePaths(options.file);
  }

  // Settles any update a previous supervisor left pending, starts the server, and resolves with
  // the exit code to leave with once it has stopped for good.
  async run(): Promise<number> {
    const exited = new Promise<number>((resolve) => (this.#finish = resolve));
    await settle(this.#options.file).catch((error: unknown) => this.#log(`couldn't read the last update: ${String(error)}`));
    this.#startActive();
    return exited;
  }

  // Passes a stop signal on, and kills a server that hasn't exited after the grace period. Any
  // update in progress is abandoned, and the old file stays.
  stop(signal: NodeJS.Signals) {
    const first = !this.#stopping;
    this.#stopping = true;
    this.#abort.abort();
    const children = [this.#active, this.#pending?.trial].filter((child) => child != null);
    for (const child of children) {
      child.process.kill(signal);
      if (first) setTimeout(() => child.process.kill("SIGKILL"), this.#options.stopGraceMs ?? STOP_GRACE_MS).unref();
    }
    // Between stopping the old server and starting the trial, nothing is running to wait for.
    if (children.length === 0 && !this.#updating) this.#finish(0);
  }

  #log(line: string) {
    process.stderr.write(`runnerbox supervisor: ${line}\n`);
  }

  #spawn(file: string, context: ChildContext): Managed {
    const { node, nodeArgs, args, env } = this.#options;
    const child = spawn(node, [...nodeArgs, file, ...args], {
      env: { ...env, [SUPERVISED_ENV]: JSON.stringify(context) },
      // A trial's errors are kept to say why it failed, and still reach the log.
      stdio: ["inherit", "inherit", context.role === "trial" ? "pipe" : "inherit", "ipc"],
    });
    const managed: Managed = {
      process: child,
      role: context.role,
      version: null,
      stderr: "",
      exited: new Promise((resolve) => {
        child.once("error", (error) => {
          this.#log(`couldn't start the server: ${error.message}`);
          resolve(1);
        });
        child.once("exit", (code, signal) => resolve(exitCodeOf(code, signal)));
      }),
    };
    child.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
      managed.stderr = (managed.stderr + chunk.toString()).slice(-4096);
    });
    child.on("message", (raw) => {
      const message = decodeChildMessage(raw);
      if (message !== null) void this.#onMessage(managed, message).catch((error: unknown) => this.#log(String(error)));
    });
    // A server that exits closes its end; sends to it after that are dropped.
    child.on("error", () => undefined);
    void managed.exited.then((code) => this.#onExit(managed, code));
    return managed;
  }

  #startActive() {
    const context: ChildContext = { protocol: SUPERVISOR_PROTOCOL, file: this.#options.file, role: "active" };
    this.#active = this.#spawn(this.#options.file, context);
  }

  #onExit(managed: Managed, code: number) {
    if (this.#retiring.has(managed)) return;
    if (this.#pending?.trial === managed) return void this.#trialFailed(managed, `It stopped with code ${code} before it was ready.${this.#tail(managed)}`);
    if (managed === this.#active) {
      this.#active = null;
      this.#finish(code);
    }
  }

  #tail(managed: Managed) {
    const line = lastLine(managed.stderr);
    return line === "" ? "" : ` Its last error: ${line}`;
  }

  #send(managed: Managed, message: SupervisorMessage) {
    if (managed.process.connected) managed.process.send(message, () => undefined);
  }

  async #onMessage(managed: Managed, message: ChildMessage) {
    if (message.type === "ready") {
      managed.version = message.version;
      if (this.#pending?.trial === managed) await this.#trialReady(this.#pending, message.version);
      return;
    }
    if (managed !== this.#active || managed.role !== "active") return;
    const refusal = await this.#update(managed, message).catch((error: unknown) => `Something went wrong: ${error instanceof Error ? error.message : String(error)}`);
    if (refusal !== null) this.#send(managed, { type: "update-refused", reason: refusal });
  }

  // Null once the update is under way, or why it was refused, with the old server still serving.
  async #update(active: Managed, request: Extract<ChildMessage, { type: "update" }>): Promise<string | null> {
    if (this.#updating) return "An update is already running.";
    if (this.#stopping) return "The server is stopping.";
    if (active.version === null) return "The server hasn't finished starting.";
    if (!isExactVersion(request.version)) return `${request.version} isn't a release version.`;
    if (compareVersions(request.version, active.version) <= 0) return `${request.version} isn't newer than ${active.version}, and an update never goes back.`;
    const staged = this.#paths.staged(request.version);
    if (request.path !== staged) return "The download isn't where updates are kept.";
    this.#updating = true;
    const refused = await this.#check(active, request, staged).catch((error: unknown) => `Something went wrong: ${error instanceof Error ? error.message : String(error)}`);
    if (refused !== null) {
      this.#updating = false;
      return refused;
    }
    const record: UpdateRecord = { id: newUpdateId(), from: active.version, to: request.version, sha256: request.sha256, status: "pending", startedAt: new Date().toISOString() };
    try {
      await writeRecord(this.#paths.record, record);
    } catch (error) {
      this.#updating = false;
      return `The update couldn't be recorded: ${error instanceof Error ? error.message : String(error)}`;
    }
    this.#send(active, { type: "update-accepted", id: record.id });
    void this.#handOff(active, record, staged).catch((error: unknown) => this.#rollBack(record, staged, `Something went wrong: ${String(error)}`));
    return null;
  }

  // Null when the download is the one checked and runs here.
  async #check(active: Managed, request: Extract<ChildMessage, { type: "update" }>, staged: string): Promise<string | null> {
    if ((await sha256File(staged)) !== request.sha256) return "The download changed after it was checked.";
    // Checked here as well as in the server, with the keys of the version that's running.
    const keys = this.#options.releaseKeys ?? builtInReleaseKeys;
    if (keys.length > 0 && (request.signature === null || !verifyRelease(keys, request.version, request.sha256, request.signature))) {
      return "This release isn't signed with a key this version trusts, so it wasn't installed.";
    }
    const { node, nodeArgs, env, file } = this.#options;
    const timeoutMs = this.#options.preflightTimeoutMs ?? PREFLIGHT_TIMEOUT_MS;
    const failed = await preflight({ node, nodeArgs, env, file, staged, version: request.version, timeoutMs, signal: this.#abort.signal });
    if (this.#stopping || this.#active !== active) return "The server is stopping.";
    return failed === null ? null : `The new version won't run on this machine. ${failed}`;
  }

  async #handOff(active: Managed, record: UpdateRecord, staged: string) {
    await this.#step("accepted");
    await new Promise((resolve) => setTimeout(resolve, this.#options.handoffMs ?? HANDOFF_MS));
    await this.#retire(active);
    if (this.#active === active) this.#active = null;
    await this.#step("old-stopped");
    if (this.#stopping) return this.#rollBack(record, staged, STOPPED);
    const context: ChildContext = { protocol: SUPERVISOR_PROTOCOL, file: this.#options.file, role: "trial", updateId: record.id };
    const trial = this.#spawn(staged, context);
    const timeoutMs = this.#options.trialTimeoutMs ?? TRIAL_TIMEOUT_MS;
    const timer = setTimeout(() => void this.#trialFailed(trial, `It wasn't ready within ${Math.round(timeoutMs / 1000)} seconds.${this.#tail(trial)}`), timeoutMs);
    this.#pending = { record, staged, trial, timer };
    await this.#step("trial-started");
  }

  async #trialReady(pending: Pending, version: string) {
    if (this.#pending !== pending) return;
    // A stop on its way down the line wins: nothing is put in place while the service stops.
    if (this.#stopping) return this.#trialFailed(pending.trial, STOPPED);
    if (version !== pending.record.to) return this.#trialFailed(pending.trial, `It said it was version ${version}.`);
    clearTimeout(pending.timer);
    this.#pending = null;
    // It serves from here on: if it exits during the swap, the supervisor exits with it and the
    // next start settles the record by what's on disk.
    pending.trial.role = "active";
    this.#active = pending.trial;
    try {
      await keepPrevious(this.#options.file);
      await this.#step("previous-kept");
      await putInPlace(pending.staged, this.#options.file);
      await this.#step("renamed");
    } catch (error) {
      if (this.#active === pending.trial) this.#active = null;
      await this.#retire(pending.trial);
      return this.#rollBack(pending.record, pending.staged, `The new version couldn't be put in place: ${error instanceof Error ? error.message : String(error)}`);
    }
    await writeRecord(this.#paths.record, { ...pending.record, status: "committed", finishedAt: new Date().toISOString() });
    this.#updating = false;
  }

  async #trialFailed(trial: Managed, reason: string) {
    const pending = this.#pending;
    if (pending?.trial !== trial) return;
    clearTimeout(pending.timer);
    this.#pending = null;
    await this.#retire(trial);
    await this.#rollBack(pending.record, pending.staged, this.#stopping ? STOPPED : reason);
  }

  // The old file was never replaced, so going back is starting it again.
  async #rollBack(record: UpdateRecord, staged: string, reason: string) {
    this.#log(`the update to ${record.to} didn't go through: ${reason}`);
    await writeRecord(this.#paths.record, { ...record, status: "rolled-back", reason, finishedAt: new Date().toISOString() }).catch((error: unknown) => this.#log(`couldn't record it: ${String(error)}`));
    await rm(staged, { force: true });
    this.#updating = false;
    if (this.#stopping) return this.#finish(0);
    this.#startActive();
  }

  // Stops a server on purpose and waits for it to go, killing it after the grace period.
  async #retire(managed: Managed) {
    this.#retiring.add(managed);
    managed.process.kill("SIGTERM");
    const timer = setTimeout(() => managed.process.kill("SIGKILL"), this.#options.stopGraceMs ?? STOP_GRACE_MS);
    await managed.exited;
    clearTimeout(timer);
  }

  async #step(step: UpdateStep) {
    await this.#options.onStep?.(step);
  }
}
