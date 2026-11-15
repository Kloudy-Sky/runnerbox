import type { InstallState } from "@runnerbox/contracts";
import { formatAge } from "../../lib/format.ts";
import { runnerPhase } from "../../lib/runnerWords.ts";

// Each kind's runners, two lines each so they fit a narrow window: what the runner is doing and
// for how long, then the machine's reason when it gives one.
export function SlotRows({ install, now }: { install: InstallState; now: number }) {
  return (
    <div className="flex flex-col gap-2">
      {install.kinds.map((kind) => (
        <div key={kind.name}>
          <div className="text-muted-foreground">
            {kind.name} <span className="text-muted-foreground/70">· {kind.label}</span>
          </div>
          {kind.slots.map((slot) => {
            const { text, tone } = runnerPhase(slot.phase, slot.job);
            return (
              <div key={slot.slot} className="py-0.5 pl-3">
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="w-15 shrink-0 text-muted-foreground">runner {slot.slot}</span>
                  <span className={`min-w-0 truncate ${tone}`}>{text}</span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">{formatAge(slot.since, now)}</span>
                </div>
                {slot.detail ? <div className="pl-17 text-muted-foreground">{slot.detail}</div> : null}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
