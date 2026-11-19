import type { RunningJob } from "@runnerbox/contracts";
import type { RunnerMachine } from "../../hooks/useRunnerMachines.ts";
import { machineTrouble } from "../../lib/machineTrouble.ts";
import { cn } from "../../lib/utils.ts";
import { ImageFacts } from "../ImageFacts.tsx";
import { FreeMemoryChart } from "./FreeMemoryChart.tsx";
import { MachineGhost } from "./MachineGhost.tsx";
import { RunnerBays } from "./RunnerBays.tsx";
import { SectionTitle } from "./SectionTitle.tsx";

const TONE = { bad: "text-destructive", waiting: "text-warning", quiet: "text-muted-foreground" } as const;

// One machine as it is now: its runners as bays with each kind's image under them, and beside them
// its free memory over the hour, or why it's stopped. `running` is what GitHub says its runners
// run. `onPick` narrows the page to it.
export function MachineSection({ machine, running, onPick }: { machine: RunnerMachine; running: ReadonlyArray<RunningJob>; onPick: (() => void) | null }) {
  const { install, now } = machine;
  const trouble = install ? machineTrouble(install, machine.connection) : null;
  const title = onPick ? (
    <button type="button" className="uppercase hover:text-foreground" onClick={onPick}>
      {machine.name}
    </button>
  ) : (
    machine.name
  );
  return (
    <section className={cn(install?.stale && "opacity-70")}>
      <SectionTitle note={trouble?.note} noteClassName={trouble ? TONE[trouble.tone] : undefined}>
        {title}
      </SectionTitle>
      {install ? (
        <div className="grid gap-x-10 gap-y-6 lg:grid-cols-2">
          <div className="flex flex-col gap-2">
            <RunnerBays runners={install.runners} running={running} now={now} />
            <div className="text-xs">
              {machine.live?.kinds.map((kind, _, kinds) => (
                <ImageFacts key={kind.name} kind={kind} now={now} typicalBuildMs={machine.typicalBuildMs(kind.name)} named={kinds.length > 1} />
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-3">
            {trouble?.why ? <p className="text-[13px] leading-relaxed">{trouble.why}</p> : null}
            {machine.memory ? <FreeMemoryChart memory={machine.memory} now={now} /> : null}
            {install.memory._tag === "none" ? <p className="text-muted-foreground text-xs">{install.memory.why}</p> : null}
          </div>
        </div>
      ) : machine.note ? (
        <p className="text-muted-foreground">{machine.note}</p>
      ) : (
        <MachineGhost />
      )}
    </section>
  );
}
