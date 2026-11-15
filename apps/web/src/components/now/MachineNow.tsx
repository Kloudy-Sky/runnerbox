import type { InstallState, MachineSample } from "@runnerbox/contracts";
import { ChevronRight } from "lucide-react";
import { formatMiB } from "../../lib/format.ts";
import type { Lane } from "../../lib/now.ts";
import { ImageFacts } from "../ImageFacts.tsx";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible.tsx";
import { SlotLanes } from "./SlotLanes.tsx";

// The machine under the jobs: how much memory is in use, each kind's image, and, folded away, the
// last hour of every slot.
export function MachineNow(props: {
  install: InstallState;
  sample: MachineSample | undefined;
  lanes: ReadonlyArray<Lane>;
  now: number;
  typicalBuildMs: (kind: string) => number | null;
}) {
  const { install, sample, lanes, now, typicalBuildMs } = props;
  const vm = sample?.vm;
  return (
    <div className="flex flex-col gap-2">
      {vm ? (
        <div className="grid grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-x-3">
          <span className="text-muted-foreground">Memory</span>
          <span className="h-1.5 bg-muted">
            <span className="block h-full bg-muted-foreground" style={{ width: `${Math.round(((vm.totalMiB - vm.availableMiB) / vm.totalMiB) * 100)}%` }} />
          </span>
          <span className="text-muted-foreground tabular-nums">
            {formatMiB(vm.totalMiB - vm.availableMiB)} of {formatMiB(vm.totalMiB)}
          </span>
        </div>
      ) : null}
      {install.kinds.map((kind) => (
        <div key={kind.name}>
          {install.kinds.length > 1 ? <div className="text-muted-foreground">{kind.name}</div> : null}
          <ImageFacts kind={kind} now={now} typicalBuildMs={typicalBuildMs(kind.name)} />
        </div>
      ))}
      <Collapsible>
        <CollapsibleTrigger className="group/lanes flex items-center gap-1 text-muted-foreground hover:text-foreground">
          <ChevronRight className="size-3.5 transition-transform duration-150 group-data-panel-open/lanes:rotate-90" />
          The last hour, slot by slot
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <div className="pt-2">
            <SlotLanes lanes={lanes} />
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  );
}
