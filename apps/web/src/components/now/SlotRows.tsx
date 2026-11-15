import type { InstallState } from "@runnerbox/contracts";
import { formatAge } from "../../lib/format.ts";
import { PHASE } from "../InstallState.tsx";

// Each kind's slots, two lines each so they fit a narrow window: what the slot is doing and for how
// long, then the job it's on, or the machine's reason when it gives one.
export function SlotRows({ install, now }: { install: InstallState; now: number }) {
  return (
    <div className="flex flex-col gap-2">
      {install.kinds.map((kind) => (
        <div key={kind.name}>
          <div className="text-muted-foreground">
            {kind.name} <span className="text-muted-foreground/70">· {kind.label}</span>
          </div>
          {kind.slots.map((slot) => {
            const [label, color] = PHASE[slot.phase];
            return (
              <div key={slot.slot} className="py-0.5 pl-3">
                <div className="flex items-baseline gap-2">
                  <span className="w-11 shrink-0 text-muted-foreground">slot {slot.slot}</span>
                  <span className={color}>{label}</span>
                  <span className="text-muted-foreground tabular-nums">{formatAge(slot.since, now)}</span>
                </div>
                {slot.job ? <div className="truncate pl-13">{slot.job}</div> : null}
                {slot.detail ? <div className="pl-13 text-muted-foreground">{slot.detail}</div> : null}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
