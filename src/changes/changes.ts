import { createHash } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { type } from "arktype";
import { LauncherConfig } from "../launcher/launcher-config.ts";
import type { Accepted, ApplyRequest, Described } from "../control/protocol.ts";
import { fieldsOf, type Machine, refusal, type Value, withField } from "./change-paths.ts";

// Applies a change the owner approved in the app to this install's config, and nothing else. `up`
// checks it all itself, whatever the server sent: the path is on the allow-list, the value is in
// bounds for this machine, the result loads, and the config still holds what the owner saw. Then it
// keeps the old file, writes the new one, logs both, and drains, so its service manager starts it
// again on the new config. A busy job always finishes first.

export const IDLE_CHECK_MS = 60_000;
// Waiting longer than this for a moment with no job running drops the change; it's never forced.
export const IDLE_LIMIT_MS = 6 * 60 * 60_000;
export const KEEP_BACKUPS = 5;

export type ChangesActions = {
  configPath: string;
  // `<state>/<install>/changes.ndjson`, which `runnerbox serve` reads to show and revert changes.
  logPath: string;
  machine: () => Promise<Machine>;
  // Whether any of this install's runners is running a job now.
  busy: () => Promise<boolean>;
  drain: (why: string) => void;
  every: (ms: number, check: () => Promise<void>) => () => void;
  now: () => number;
  log: (message: string) => void;
};

export class ChangeRefused extends Error {}

type Waiting = ApplyRequest & { since: number };

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const iso = (ms: number) => new Date(ms).toISOString();
const show = (value: Value) => (typeof value === "string" ? value : String(value));

export function createChanges(actions: ChangesActions) {
  const { configPath, now } = actions;
  let waiting: Waiting | null = null;

  const record = async (entry: Record<string, unknown>) => {
    await mkdir(dirname(actions.logPath), { recursive: true, mode: 0o700 });
    await appendFile(actions.logPath, `${JSON.stringify({ time: iso(now()), ...entry })}\n`, { mode: 0o600 });
  };
  // For outcomes nobody is waiting on an answer for: a failed write goes to `up`'s log instead.
  const note = (entry: Record<string, unknown>) => record(entry).catch((cause: unknown) => actions.log(`couldn't log a change: ${cause}`));

  // The config on disk, which is what `up` will start with next, and only if it takes proposals.
  async function current() {
    const text = await readFile(configPath, "utf8");
    const raw: unknown = JSON.parse(text);
    const config = LauncherConfig(structuredClone(raw));
    if (config instanceof type.errors) throw new ChangeRefused(`The config doesn't load: ${config.summary}`);
    if (!("vm" in config)) throw new ChangeRefused("Proposals change VM installs only.");
    if (config.changes !== true) throw new ChangeRefused('This install doesn\'t take proposals: its config has no "changes": true.');
    return { text, raw, fields: fieldsOf(config, await actions.machine()) };
  }

  // The new file's text, or why the change can't go in. Checked when the request arrives and again
  // just before writing.
  async function plan(request: ApplyRequest) {
    const { text, raw, fields } = await current();
    const paths = request.changes.map((change) => change.path);
    if (new Set(paths).size !== paths.length) throw new ChangeRefused("A proposal changes each field once.");
    let next = raw;
    for (const change of request.changes) {
      const field = fields.find((candidate) => candidate.path === change.path);
      if (!field) throw new ChangeRefused(`${change.path} isn't a field a proposal can change.`);
      if (field.value !== change.from) throw new ChangeRefused(`The config changed since this was proposed: ${change.path} is ${show(field.value)} now, not ${show(change.from)}.`);
      const why = refusal(field, change.to);
      if (why) throw new ChangeRefused(why);
      next = withField(next, change.path, change.to);
    }
    const loaded = LauncherConfig(structuredClone(next));
    if (loaded instanceof type.errors) throw new ChangeRefused(`The changed config wouldn't load: ${loaded.summary}`);
    return { before: text, after: `${JSON.stringify(next, null, 2)}\n` };
  }

  async function keepBackup(text: string) {
    const backup = `${configPath}.${iso(now()).replaceAll(":", "-")}.bak`;
    await writeFile(backup, text, { mode: 0o600 });
    const prefix = `${basename(configPath)}.`;
    const backups = (await readdir(dirname(configPath))).filter((name) => name.startsWith(prefix) && name.endsWith(".bak")).toSorted();
    for (const old of backups.slice(0, -KEEP_BACKUPS)) await rm(join(dirname(configPath), old), { force: true });
  }

  // Writes the change and drains, or says why it didn't: a config changed by hand since the
  // approval, or a fault such as an SSH read or a write that failed. It never throws, so a fault
  // can't take `up` down, and every outcome is logged. Returns why it wasn't applied, or null.
  async function commit(request: ApplyRequest): Promise<string | null> {
    waiting = null;
    const { proposalId, hash, approvedBy, changes } = request;
    const temporary = `${configPath}.${process.pid}.tmp`;
    let planned: Awaited<ReturnType<typeof plan>>;
    try {
      planned = await plan(request);
      await keepBackup(planned.before);
      const { mode } = await stat(configPath);
      await writeFile(temporary, planned.after, { mode: mode & 0o777 });
      await rename(temporary, configPath);
    } catch (error) {
      const reason = error instanceof ChangeRefused ? error.message : "up couldn't apply it; its log says why";
      if (!(error instanceof ChangeRefused)) actions.log(`change ${proposalId}: ${error instanceof Error ? error.message : error}`);
      await rm(temporary, { force: true }).catch(() => {});
      await note({ outcome: "not_applied", proposalId, hash, approvedBy, changes, reason });
      actions.log(`change ${proposalId}: not applied, ${reason}`);
      return reason;
    }
    // The file on disk has changed, so `up` drains even if the log line can't be written.
    try {
      await record({ outcome: "applied", proposalId, hash, approvedBy, when: request.when, changes, configSha256Before: sha256(planned.before), configSha256After: sha256(planned.after) });
    } catch (cause) {
      actions.log(`change ${proposalId}: written, but couldn't log it: ${cause}`);
    } finally {
      actions.log(`change ${proposalId}: written, restarting once busy jobs finish`);
      actions.drain(`applying change ${proposalId}`);
    }
    return null;
  }

  async function describe(): Promise<Described> {
    const { fields } = await current();
    const pending = waiting ? { proposalId: waiting.proposalId, when: waiting.when, since: iso(waiting.since) } : null;
    return { install: basename(configPath, ".json"), fields, pending };
  }

  async function apply(request: ApplyRequest): Promise<Accepted> {
    if (waiting) throw new ChangeRefused("Another change is already waiting to apply.");
    await plan(request);
    await record({ outcome: "accepted", proposalId: request.proposalId, hash: request.hash, approvedBy: request.approvedBy, when: request.when, changes: request.changes });
    if (request.when === "idle") {
      waiting = { ...request, since: now() };
      return { accepted: true, when: "idle" };
    }
    // Applied now, so the answer says what happened, as the log does.
    const notApplied = await commit(request);
    if (notApplied !== null) throw new ChangeRefused(`Not applied: ${notApplied}`);
    return { accepted: true, when: "now" };
  }

  // Applies a waiting change at the first moment no job is running, or drops it after 6 hours.
  // It never throws: `every` runs it unwatched, and a fault here must not stop `up`.
  async function check() {
    const change = waiting;
    if (!change) return;
    if (now() - change.since > IDLE_LIMIT_MS) {
      waiting = null;
      await note({ outcome: "not_applied", proposalId: change.proposalId, hash: change.hash, approvedBy: change.approvedBy, changes: change.changes, reason: "no moment without a running job came in 6 hours" });
      return;
    }
    if (!(await actions.busy().catch(() => true))) await commit(change);
  }

  let stopChecking: (() => void) | null = null;
  return {
    describe,
    apply,
    check,
    begin() {
      stopChecking = actions.every(IDLE_CHECK_MS, check);
    },
    // As `up` drains for any other reason, a waiting change is dropped and says so.
    async close() {
      stopChecking?.();
      const change = waiting;
      waiting = null;
      if (change) await note({ outcome: "not_applied", proposalId: change.proposalId, hash: change.hash, approvedBy: change.approvedBy, changes: change.changes, reason: "up stopped before it could apply" });
    },
  };
}

export type Changes = ReturnType<typeof createChanges>;
