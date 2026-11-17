import type { MachineHealth } from "@runnerbox/contracts";
import { formatMiB } from "../../lib/format.ts";
import { cn } from "../../lib/utils.ts";
import { HEALTH_COLUMNS, HealthRow } from "./HealthRow.tsx";
import { UPTIME_STYLE } from "./UptimeStrip.tsx";

// A machine's answer, or why there's none: not connected yet, or it couldn't say.
export type MachineAnswer = { readonly environmentId: string; readonly label: string; readonly health: readonly MachineHealth[] | undefined; readonly isError: boolean };

const LEGEND = [
  { className: UPTIME_STYLE.up.className, label: "Took jobs all day" },
  { className: UPTIME_STYLE.partial.className, label: "Part of the day" },
  { className: UPTIME_STYLE.down.className, label: "Stopped" },
  { className: UPTIME_STYLE.off.className, label: "Off, normal for a machine that sleeps" },
];

// Every install on every machine picked, one row each, under one header and over one legend.
export function HealthRows({ machines, length }: { readonly machines: readonly MachineAnswer[]; readonly length: number }) {
  const pauses = new Set(machines.flatMap((machine) => machine.health ?? []).flatMap((health) => (health.pauseBelowMiB === null ? [] : [health.pauseBelowMiB])));
  return (
    <div className="@container flex flex-col gap-4">
      <div className={cn("hidden gap-x-6 text-xs text-muted-foreground @3xl:grid", HEALTH_COLUMNS)}>
        <span />
        <span>Taking jobs</span>
        <span>Lowest free memory each day</span>
        <span>Jobs</span>
        <span>Failed because of the machine</span>
      </div>
      {machines.map((machine) =>
        machine.health ? (
          machine.health.length === 0 ? (
            <p key={machine.environmentId} className="text-muted-foreground">
              {machine.label} has no runner records yet.
            </p>
          ) : (
            machine.health.map((health) => <HealthRow key={`${machine.environmentId}\0${health.install}`} health={health} machine={machine.label} length={length} />)
          )
        ) : (
          <p key={machine.environmentId} className="text-muted-foreground">
            {machine.label}: {machine.isError ? "couldn't read its health. Its server may need an update." : "not connected."}
          </p>
        ),
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {LEGEND.map((entry) => (
          <span key={entry.label} className="flex items-center gap-1.5">
            <i className={cn("size-2 rounded-[2px]", entry.className)} />
            {entry.label}
          </span>
        ))}
        {pauses.size > 0 ? (
          <span className="flex items-center gap-1.5">
            <i className="w-3 border-t border-dashed border-warning" />
            {pauses.size === 1 ? `Runners pause below ${formatMiB([...pauses][0])}` : "Runners pause below the dashed line"}
          </span>
        ) : null}
      </div>
    </div>
  );
}
