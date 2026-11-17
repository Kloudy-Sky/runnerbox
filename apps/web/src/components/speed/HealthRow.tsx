import type { MachineHealth } from "@runnerbox/contracts";
import { cn } from "../../lib/utils.ts";
import { describeHealth, type Tone } from "./healthWords.ts";
import { MemoryLows } from "./MemoryLows.tsx";
import { UptimeStrip } from "./UptimeStrip.tsx";

export const HEALTH_COLUMNS = "@3xl:grid-cols-[9rem_minmax(0,1fr)_9.5rem_4rem_9rem]";
const TONE_TEXT: Record<Tone, string> = { bad: "text-destructive", warn: "text-warning", muted: "text-muted-foreground" };
const WEEK = 7;

// One machine over the window: when it took jobs, its lowest free memory each day, the jobs it
// took and the ones it failed itself, and a sentence on what's going on. In a narrow column the
// cells stack and name themselves.
export function HealthRow({ health, machine, length }: { readonly health: MachineHealth; readonly machine: string; readonly length: number }) {
  const { status, sentence } = describeHealth(health);
  const days = health.days.slice(-length);
  const jobs = days.reduce((total, day) => total + day.jobsTaken, 0);
  const failed = days.reduce((total, day) => total + day.failedByMachine, 0);
  const thisWeek = days.slice(-WEEK).reduce((total, day) => total + day.failedByMachine, 0);
  return (
    <div className="flex flex-col gap-1.5">
      <div className={cn("grid grid-cols-2 items-center gap-x-6 gap-y-2", HEALTH_COLUMNS)}>
        <div className="col-span-2 flex min-w-0 flex-col @3xl:col-span-1">
          <span className="truncate font-medium">
            {health.install}
            {/* Two machines can each have an install of the same name, so the machine says which. */}
            {machine !== health.install ? <span className="font-normal text-muted-foreground"> on {machine}</span> : null}
          </span>
          {status ? <span className={cn("text-xs", TONE_TEXT[status.tone])}>{status.text}</span> : null}
        </div>
        <div className="col-span-2 @3xl:col-span-1">
          <UptimeStrip days={days} length={length} />
        </div>
        <div className="col-span-2 @3xl:col-span-1">
          <MemoryLows days={days} length={length} pauseBelowMiB={health.pauseBelowMiB} />
        </div>
        <span className="tabular-nums">
          {jobs.toLocaleString()}
          <span className="text-muted-foreground @3xl:hidden"> jobs</span>
        </span>
        <span className={failed > 0 ? "text-destructive" : "text-muted-foreground"}>
          {failed}
          <span className="text-muted-foreground @3xl:hidden"> failed because of the machine</span>
          {failed > 0 && thisWeek === failed ? ", all this week" : ""}
        </span>
      </div>
      <p className="text-foreground/90 @3xl:pl-[calc(9rem+1.5rem)]">{sentence}</p>
    </div>
  );
}
