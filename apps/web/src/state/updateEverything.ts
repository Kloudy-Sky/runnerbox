import type { UpdateState } from "@runnerbox/client-runtime";
import { create } from "zustand";
import { isHandedOff, machineStatus, type MachineStatus, type RunPhase } from "../lib/updateEverything.ts";
import { platform } from "../platform.ts";
import { startUpdate, useServerUpdates } from "./serverUpdates.ts";

// One run of the sidebar's Update: every server at once, then this app, after T3 Code's
// `updateEverythingRun.tsx` (MIT, see THIRD_PARTY_NOTICES.md). Each server's own steps live in
// `serverUpdates.ts`, where its notice reads them too; this keeps only what spans them.

export type RunMachine = { readonly environmentId: string; readonly label: string; readonly startedAt: number };

export type EverythingRun = {
  readonly target: string;
  // Whether this desktop app restarts on `target` once the servers have theirs.
  readonly installsApp: boolean;
  readonly phase: RunPhase;
  readonly restartAt: number | null;
  readonly machines: ReadonlyArray<RunMachine>;
};

export const useUpdateEverything = create<{ readonly run: EverythingRun | null }>()(() => ({ run: null }));

export const COUNTDOWN_MS = 10_000;

let countdown: ReturnType<typeof setTimeout> | undefined;
let stopWatching = () => {};

const change = (next: (run: EverythingRun) => EverythingRun) => useUpdateEverything.setState(({ run }) => ({ run: run && next(run) }));
const current = () => useUpdateEverything.getState().run;
const statusOf = (environmentId: string) => machineStatus(useServerUpdates.getState().runs[environmentId]);

// Resolves once `until` holds for every one of these servers' updates.
function serversReach(environmentIds: ReadonlyArray<string>, until: (status: MachineStatus) => boolean) {
  return new Promise<void>((resolve) => {
    const reached = () => environmentIds.every((id) => until(statusOf(id)));
    if (reached()) return resolve();
    const unsubscribe = useServerUpdates.subscribe(() => {
      if (!reached()) return;
      unsubscribe();
      resolve();
    });
  });
}

// Resolves with the app updater's state once it's no longer downloading.
function appDownloaded() {
  const updates = platform.updates;
  if (!updates) return Promise.resolve(null);
  return new Promise<UpdateState>((resolve) => {
    const settle = (state: UpdateState) => {
      if (state.status === "downloading" || state.status === "checking") return;
      unsubscribe();
      resolve(state);
    };
    const unsubscribe = updates.subscribe(settle);
    void updates.state().then(settle);
  });
}

// After the servers: this app restarts once every server's supervisor has its update, since a
// restart here can't change how those end. With no app to restart, the run lasts until each server
// is done. A failure holds everything, so its Retry isn't lost to a restart.
export async function afterServers(run: EverythingRun) {
  const ids = run.machines.map((machine) => machine.environmentId);
  await serversReach(ids, run.installsApp ? isHandedOff : (status) => status === "done" || status === "failed");
  if (current() !== run || ids.some((id) => statusOf(id) === "failed")) return;
  if (!run.installsApp) return useUpdateEverything.setState({ run: null });
  const app = await appDownloaded();
  if (current() !== run || app?.status !== "ready") return;
  startCountdown(ids);
}

// Stops the app's countdown, and the watch over its servers.
function stopCountdown() {
  clearTimeout(countdown);
  stopWatching();
  stopWatching = () => {};
}

// A server still restarting when the countdown starts can yet roll back or not come back. That
// holds the restart too, as a failure before it does, so Retry isn't lost to it.
function startCountdown(ids: ReadonlyArray<string>) {
  stopCountdown();
  change((latest) => ({ ...latest, phase: "countdown", restartAt: Date.now() + COUNTDOWN_MS }));
  countdown = setTimeout(restartApp, COUNTDOWN_MS);
  stopWatching = useServerUpdates.subscribe(() => {
    if (!ids.some((id) => statusOf(id) === "failed")) return;
    stopCountdown();
    change((latest) => ({ ...latest, phase: "servers", restartAt: null }));
  });
}

export function updateEverything(target: string, servers: ReadonlyArray<{ readonly environmentId: string; readonly label: string }>, installsApp: boolean) {
  stopCountdown();
  const startedAt = Date.now();
  const run: EverythingRun = { target, installsApp, phase: "servers", restartAt: null, machines: servers.map(({ environmentId, label }) => ({ environmentId, label, startedAt })) };
  useUpdateEverything.setState({ run });
  for (const { environmentId } of servers) void startUpdate(environmentId, target);
  void afterServers(run);
}

// Asks each failed server again, and starts waiting for them over.
export function retryFailed() {
  stopCountdown();
  const run = current();
  if (!run) return;
  const failed = new Set(run.machines.filter(({ environmentId }) => statusOf(environmentId) === "failed").map(({ environmentId }) => environmentId));
  const startedAt = Date.now();
  const retried: EverythingRun = { ...run, phase: "servers", machines: run.machines.map((machine) => (failed.has(machine.environmentId) ? { ...machine, startedAt } : machine)) };
  useUpdateEverything.setState({ run: retried });
  for (const environmentId of failed) void startUpdate(environmentId, run.target);
  void afterServers(retried);
}

export function restartLater() {
  stopCountdown();
  change((run) => ({ ...run, phase: "later", restartAt: null }));
}

export function restartApp() {
  stopCountdown();
  change((run) => ({ ...run, phase: "installing", restartAt: null }));
  // The app quits here. If it doesn't, the row offers Restart again.
  void platform.updates?.install().catch(() => change((run) => ({ ...run, phase: "later" })));
}

export function dismissRun() {
  stopCountdown();
  useUpdateEverything.setState({ run: null });
}
