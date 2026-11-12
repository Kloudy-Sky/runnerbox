import type { InstallState as Install, SlotPhase } from "@runnerbox/contracts";
import { formatAge } from "../lib/format.ts";

const PHASE: Record<SlotPhase, [string, string]> = {
  registered: ["listening", "text-success"],
  busy: ["on a job", "text-foreground"],
  minting: ["registering", "text-muted-foreground"],
  waiting: ["waiting for memory", "text-warning"],
  backoff: ["backing off", "text-destructive"],
  stopped: ["stopped", "text-muted-foreground"],
};

// One install as `up` reports it now: each kind's image and each slot's phase.
export function InstallState({ install }: { install: Install }) {
  return (
    <div className="pb-4">
      <div className="flex items-baseline gap-3">
        <span className="font-medium">{install.install}</span>
        <span className="text-muted-foreground">up since {formatAge(install.startedAt)} ago, pid {install.pid}</span>
        {install.stopping ? <span className="text-warning">draining</span> : null}
        {install.stale ? <span className="text-destructive">not updated for {formatAge(install.updatedAt)}, so up may have stopped</span> : null}
      </div>
      <table className={`mt-1 border-collapse ${install.stale ? "opacity-50" : ""}`}>
        <tbody>
          {install.kinds.flatMap((kind) => [
            <tr key={kind.name}>
              <td colSpan={5} className="pt-2 pb-0.5">
                <span>{kind.name}</span>
                <span className="ml-3 text-muted-foreground">{kind.label}</span>
                <span className="ml-3 font-mono text-[11.5px] text-muted-foreground">{kind.image ?? "no image yet"}</span>
                {kind.building ? <span className="ml-3 text-warning">building {kind.building}</span> : null}
              </td>
            </tr>,
            ...kind.slots.map((slot) => {
              const [label, color] = PHASE[slot.phase];
              return (
                <tr key={`${kind.name}${slot.slot}`}>
                  <td className="py-0.5 pr-4 pl-3 text-muted-foreground">slot {slot.slot}</td>
                  <td className={`py-0.5 pr-4 whitespace-nowrap ${color}`}>{label}</td>
                  <td className="py-0.5 pr-4 text-muted-foreground">{formatAge(slot.since)}</td>
                  <td className="py-0.5 pr-4 font-mono text-[11.5px] text-muted-foreground">{slot.runner}</td>
                  <td className="py-0.5 text-muted-foreground">{slot.detail}</td>
                </tr>
              );
            }),
          ])}
        </tbody>
      </table>
    </div>
  );
}
