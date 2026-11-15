import { ArrowUp } from "lucide-react";
import { useDesktopUpdates } from "../../hooks/useDesktopUpdates.ts";
import { useNow } from "../../hooks/useNow.ts";
import { cn } from "../../lib/utils.ts";
import { type AppStep, describeRow, failureOf, formatElapsed, isActive, isHandedOff, machineStatus, secondsLeft, STATUS_WORDS } from "../../lib/updateEverything.ts";
import { useServerUpdates } from "../../state/serverUpdates.ts";
import { dismissRun, type EverythingRun, restartApp, restartLater, retryFailed } from "../../state/updateEverything.ts";
import { Button } from "../ui/button.tsx";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover.tsx";
import { ROW } from "./row.ts";

const ACTIONS = { later: ["Later", restartLater], restart: ["Restart", restartApp], retry: ["Retry", retryFailed], dismiss: ["Dismiss", dismissRun] } as const;

// The Update row during a run, after T3 Code's `SidebarUpdateCapsule.tsx`: one line for where it
// is, naming a machine that's slow, with Later, Retry or Restart beside it. Click it for every
// machine. A failure holds the app's restart, so Retry survives; Restart app now goes on anyway.
export function UpdateRunRow({ run }: { run: EverythingRun }) {
  const runs = useServerUpdates((state) => state.runs);
  const desktop = useDesktopUpdates();
  const machines = run.machines.map((machine) => ({ ...machine, status: machineStatus(runs[machine.environmentId]), failure: failureOf(runs[machine.environmentId]) }));
  const appStatus = desktop?.state.status;
  const app: AppStep = !run.installsApp ? "none" : appStatus === "ready" ? "ready" : appStatus === "downloading" || appStatus === "checking" ? "downloading" : "failed";
  const ticking = run.phase === "countdown" ? 1_000 : machines.some(({ status }) => isActive(status)) ? 30_000 : null;
  const now = useNow(ticking);
  const view = describeRow(run.phase, run.restartAt, machines, app, now);
  const settled = machines.every(({ status }) => isHandedOff(status));
  const held = settled && machines.some(({ status }) => status === "failed");
  const action = view.action === null ? null : ACTIONS[view.action];
  const appWords =
    run.phase === "countdown" && run.restartAt !== null
      ? `restarts in ${secondsLeft(run.restartAt, now)}s`
      : run.phase === "installing"
        ? "restarting"
        : app === "failed"
          ? (desktop?.state.message ?? "its update stopped")
          : app === "downloading"
            ? "downloading"
            : held
              ? "held"
              : "restarts after the servers";
  return (
    <Popover>
      <div className={cn(ROW, "pr-0 hover:bg-transparent", view.tone === "failed" && "text-destructive")}>
        <PopoverTrigger
          render={
            <button type="button" className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left outline-none">
              <ArrowUp className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{view.label}</span>
              {view.elapsed ? <span className="shrink-0 text-warning tabular-nums">{view.elapsed}</span> : null}
            </button>
          }
        />
        {action ? (
          <button type="button" className="shrink-0 px-2 text-foreground underline underline-offset-3" onClick={action[1]}>
            {action[0]}
          </button>
        ) : null}
      </div>
      <PopoverPopup side="top" align="start" padding="compact" width="sm">
        <div className="flex flex-col gap-1 text-xs">
          {run.installsApp ? (
            <div className="flex justify-between gap-3">
              <span className="shrink-0">This app</span>
              <span className={cn("text-right", app === "failed" ? "text-destructive" : "text-muted-foreground")}>{appWords}</span>
            </div>
          ) : null}
          {machines.map((machine) => (
            <div key={machine.environmentId} className="flex min-w-0 flex-col">
              <div className="flex justify-between gap-3">
                <span className="truncate">{machine.label}</span>
                <span className={cn("shrink-0 tabular-nums", machine.status === "failed" ? "text-destructive" : machine.status === "done" ? "text-success" : "text-muted-foreground")}>
                  {STATUS_WORDS[machine.status]}
                  {isActive(machine.status) ? ` ${formatElapsed(now - machine.startedAt)}` : ""}
                </span>
              </div>
              {machine.failure ? <span className="break-words text-muted-foreground">{machine.failure}</span> : null}
            </div>
          ))}
          {held ? (
            <div className="mt-1 flex justify-end gap-1.5">
              {app === "ready" ? (
                <Button size="xs" variant="secondary" onClick={restartApp}>
                  Restart app now
                </Button>
              ) : (
                <Button size="xs" variant="ghost" onClick={dismissRun}>
                  Dismiss
                </Button>
              )}
              <Button size="xs" onClick={retryFailed}>
                Retry
              </Button>
            </div>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
