import type { UpdateState } from "@runnerbox/client-runtime";
import type { ReleaseCheck, UpdateBlocker } from "@runnerbox/contracts";
import semver from "semver";
import type { UpdateRun } from "./serverUpdate.ts";

// Updating every connected machine in one step, after T3 Code's update everything
// (`components/sidebar/updateEverything.logic.ts`, MIT, see THIRD_PARTY_NOTICES.md). These are the
// decisions; `state/updateEverything.ts` runs them and the sidebar's Update row shows them.

// The release every server moves to: the one this desktop app is downloading or has ready, so the
// app and its servers land on the same version, else the app's own. Null for a build from a
// checkout, which has no release to point at.
export function targetVersion(appVersion: string, desktop: UpdateState | null): string | null {
  const pending = desktop?.pending ?? null;
  if ((desktop?.status === "downloading" || desktop?.status === "ready") && pending !== null && semver.valid(pending) !== null) return pending;
  return semver.valid(appVersion) !== null && appVersion !== "0.0.0" ? appVersion : null;
}

// What a release check found. `unchecked`: the server is older than `server.checkRelease`, so its
// update finds out on its own.
export type ReleaseFinding = ReleaseCheck["signature"] | "unchecked" | { readonly failed: string };

// One saved environment, as far as the plan needs. `undefined` is a question not answered yet.
// `blocker` and `release` are asked only once the confirmation opens: the release check goes to
// GitHub.
export type MachineFacts = {
  readonly environmentId: string;
  readonly label: string;
  // `connect`: connected, but over Connect, which only reads.
  readonly reach: "direct" | "connect" | "offline";
  // Null when it didn't say.
  readonly serverVersion: string | null | undefined;
  readonly canWrite: boolean;
  // Whether it answers `server.update`.
  readonly selfUpdates: boolean | undefined;
  readonly blocker: UpdateBlocker | null | undefined;
  readonly release: ReleaseFinding | undefined;
  readonly updating: boolean;
};

export type Skipped = { readonly environmentId: string; readonly label: string; readonly reason: string };

export type UpdatePlan = {
  readonly servers: ReadonlyArray<{ readonly environmentId: string; readonly label: string; readonly from: string }>;
  // Servers still being asked whether they can take it.
  readonly checking: ReadonlyArray<{ readonly environmentId: string; readonly label: string; readonly from: string | null }>;
  readonly skipped: ReadonlyArray<Skipped>;
};

const BLOCKER_REASONS: Record<UpdateBlocker, string> = {
  checkout: "built from a checkout",
  unsupervised: "needs a manual update",
  "not-writable": "needs a manual update",
  updating: "already updating",
  "turn-running": "an agent is answering in a thread",
  "monitor-running": "a monitor is looking into an item",
  "reproduce-running": "a reproduce container is running",
};

function releaseReason(release: ReleaseFinding, target: string): string | null {
  if (release === "missing") return `${target} isn't signed`;
  if (release === "invalid") return `${target} isn't signed by a key it trusts`;
  if (typeof release === "object") return /\b404\b/.test(release.failed) ? `no runnerbox.js for ${target} yet` : `couldn't check ${target}: ${release.failed}`;
  return null;
}

const isBehind = (serverVersion: string, target: string) => semver.valid(serverVersion) !== null && semver.lt(serverVersion, target);

// Which servers move to `target`, which are still being asked, and which are skipped and why.
// A server already on `target`, or newer, isn't mentioned at all.
export function planUpdate(machines: ReadonlyArray<MachineFacts>, target: string): UpdatePlan {
  const servers: Array<UpdatePlan["servers"][number]> = [];
  const checking: Array<UpdatePlan["checking"][number]> = [];
  const skipped: Array<Skipped> = [];
  for (const machine of machines) {
    const { environmentId, label, serverVersion } = machine;
    const skip = (reason: string) => skipped.push({ environmentId, label, reason });
    if (machine.reach === "offline") {
      if (typeof serverVersion !== "string" || isBehind(serverVersion, target)) skip("offline");
      continue;
    }
    if (serverVersion === undefined) {
      checking.push({ environmentId, label, from: null });
      continue;
    }
    if (serverVersion === null) {
      skip("didn't say its version");
      continue;
    }
    // A server that reports 0.0.0 is from before versions were reported, so it's behind too.
    if (!isBehind(serverVersion, target)) continue;
    const from = serverVersion;
    const unreleased = machine.release === undefined ? null : releaseReason(machine.release, target);
    if (machine.reach === "connect") skip("reached only over Connect");
    else if (!machine.canWrite) skip("paired without the right to manage it");
    else if (machine.updating) skip("already updating");
    else if (machine.selfUpdates === false) skip("needs a manual update");
    else if (machine.blocker) skip(BLOCKER_REASONS[machine.blocker]);
    else if (unreleased !== null) skip(unreleased);
    else if (machine.selfUpdates === undefined || machine.blocker === undefined || machine.release === undefined) checking.push({ environmentId, label, from });
    else servers.push({ environmentId, label, from });
  }
  return { servers, checking, skipped };
}

// Where one machine is in a run, from the update this app asked its server for.
export type MachineStatus = "waiting" | "downloading" | "checking" | "restarting" | "done" | "failed";

export function machineStatus(run: UpdateRun | undefined): MachineStatus {
  if (run === undefined) return "waiting";
  if (run.step === "starting") return "restarting";
  if (run.step === "downloading" || run.step === "checking" || run.step === "done") return run.step;
  return "failed";
}

export function failureOf(run: UpdateRun | undefined): string | null {
  if (run?.step === "refused") return run.detail;
  if (run?.step === "rolled-back") return run.reason ?? "The new version didn't start, so the old one runs again.";
  if (run?.step === "lost") return "It hasn't come back yet. It may still be starting.";
  return null;
}

// Its supervisor has it, or it's over: nothing this app does now changes how it ends.
export const isHandedOff = (status: MachineStatus) => status === "restarting" || status === "done" || status === "failed";

export const isActive = (status: MachineStatus) => status === "downloading" || status === "checking" || status === "restarting";

// This app's own step: `none` when only servers move.
export type AppStep = "none" | "downloading" | "ready" | "failed";

export type RunPhase = "servers" | "countdown" | "later" | "installing";

export type RowView = {
  readonly tone: "default" | "slow" | "failed";
  readonly label: string;
  // How long the slowest machine has taken, when it's past `SLOW_AFTER_MS`.
  readonly elapsed: string | null;
  readonly action: "later" | "restart" | "retry" | "dismiss" | null;
};

export const SLOW_AFTER_MS = 3 * 60_000;

export function formatElapsed(ms: number) {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export const STATUS_WORDS: Record<MachineStatus, string> = {
  waiting: "waiting",
  downloading: "downloading",
  checking: "checking",
  restarting: "restarting",
  done: "done",
  failed: "failed",
};

// Seconds until the app restarts. `now` from useNow is rounded down to the second, so this rounds
// down too, or a 10 second countdown would open on 11.
export const secondsLeft = (restartAt: number, now: number) => Math.max(0, Math.floor((restartAt - now) / 1000));

// The one line the Update row shows during a run, and the one action beside it.
export function describeRow(
  phase: RunPhase,
  restartAt: number | null,
  machines: ReadonlyArray<{ readonly label: string; readonly startedAt: number; readonly status: MachineStatus }>,
  app: AppStep,
  now: number,
): RowView {
  if (phase === "countdown" && restartAt !== null) return { tone: "default", label: `App restarts in ${secondsLeft(restartAt, now)}s`, elapsed: null, action: "later" };
  if (phase === "installing") return { tone: "default", label: "Restarting", elapsed: null, action: null };
  const slowest = machines.filter(({ status }) => isActive(status)).toSorted((a, b) => a.startedAt - b.startedAt)[0];
  if (slowest && now - slowest.startedAt >= SLOW_AFTER_MS) {
    return { tone: "slow", label: `${slowest.label} ${STATUS_WORDS[slowest.status]}`, elapsed: formatElapsed(now - slowest.startedAt), action: null };
  }
  const done = machines.filter(({ status }) => status === "done").length;
  const progress = `${done} of ${machines.length} updated`;
  const failed = machines.filter(({ status }) => status === "failed");
  const settled = machines.every(({ status }) => isHandedOff(status));
  if (failed.length > 0 && settled) {
    return { tone: "failed", label: failed.length === 1 ? `${failed[0]?.label} failed` : `${failed.length} failed`, elapsed: null, action: "retry" };
  }
  if (app === "failed" && settled) return { tone: "failed", label: "This app's update stopped", elapsed: null, action: "dismiss" };
  if (phase === "later") return { tone: "default", label: machines.length === 0 ? "Update ready" : progress, elapsed: null, action: "restart" };
  if (settled && app === "downloading") return { tone: "default", label: "Downloading this app", elapsed: null, action: null };
  return { tone: "default", label: progress, elapsed: null, action: null };
}

// What the idle row says: "Update 2 servers and this app".
export function summary(serverCount: number, app: boolean) {
  const servers = serverCount === 0 ? null : `${serverCount} ${serverCount === 1 ? "server" : "servers"}`;
  return `Update ${[servers, app ? "this app" : null].filter((part) => part !== null).join(" and ")}`;
}
