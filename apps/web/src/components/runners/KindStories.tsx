import type { InstallState, KindStory } from "@runnerbox/contracts";
import { ChevronRight } from "lucide-react";
import { formatMiB } from "../../lib/format.ts";
import { ImageFacts } from "../ImageFacts.tsx";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible.tsx";

// One sentence per kind of runner, opening to its image and limits.
export function KindStories(props: { kinds: ReadonlyArray<KindStory>; live: InstallState | undefined; now: number; typicalBuildMs: (kind: string) => number | null }) {
  return (
    <div className="flex flex-col gap-1.5">
      {props.kinds.map((story) => {
        const kind = props.live?.kinds.find((each) => each.name === story.name);
        return (
          <Collapsible key={story.name}>
            <CollapsibleTrigger className="group/kind flex w-full items-start gap-1 text-left">
              <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-data-panel-open/kind:rotate-90" />
              <span>{story.sentence}</span>
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <div className="flex flex-col gap-1 pt-1 pb-1 pl-4.5">
                {kind ? <ImageFacts kind={kind} now={props.now} typicalBuildMs={props.typicalBuildMs(story.name)} /> : null}
                <span className="text-muted-foreground">
                  {story.limits ? `Each job gets up to ${formatMiB(story.limits.memoryMiB)} and ${story.limits.cpus} ${story.limits.cpus === 1 ? "CPU" : "CPUs"}.` : "The records don't say its limits yet."}
                </span>
              </div>
            </CollapsiblePanel>
          </Collapsible>
        );
      })}
    </div>
  );
}
