import { RUNNERS_QUESTION, type InstallExplained } from "@runnerbox/contracts";
import { useState } from "react";
import { Reading } from "../components/Reading.tsx";
import { Episodes } from "../components/runners/Episodes.tsx";
import { KindStories } from "../components/runners/KindStories.tsx";
import { LastHour } from "../components/runners/LastHour.tsx";
import { MemoryBar } from "../components/runners/MemoryBar.tsx";
import { RunnerRecords } from "../components/runners/RunnerRecords.tsx";
import { RunnerTiles } from "../components/runners/RunnerTiles.tsx";
import { ThreadColumn } from "../components/ThreadColumn.tsx";
import { Button } from "../components/ui/button.tsx";
import { useRange } from "../hooks/useRange.ts";
import { useRpcQuery } from "../hooks/useRpcQuery.ts";
import { useRunnerState } from "../hooks/useRunnerState.ts";
import { useServerCapabilities } from "../hooks/useServerCapabilities.ts";
import { typicalBuildMs } from "../lib/imageFacts.ts";
import { cn } from "../lib/utils.ts";

// What the machine's runners are doing, in sentences the server's rules write, with the picture
// under them and the detail folded. A server older than `runners.explain` gets the raw records.
export function RunnersPage() {
  return useServerCapabilities().runnersExplained ? <ExplainedRunners /> : <RunnerRecords />;
}

function ExplainedRunners() {
  const { days } = useRange();
  const live = useRunnerState();
  // Asked again whenever a runner changes what it's doing, not on every heartbeat.
  const phases = live?.flatMap((install) => install.kinds.flatMap((kind) => kind.slots.map((slot) => `${slot.phase}${slot.since}`))).join() ?? "";
  const explained = useRpcQuery(["runners.explain", days, phases], (client) => client["runners.explain"]({ days }), { keepPrevious: true, refetchEvery: 30_000 });
  const events = useRpcQuery(["events", days], (client) => client["runners.events"]({ days }));
  const [chosen, setChosen] = useState<string | null>(null);
  const installs = explained.data?.installs ?? [];
  const install = installs.find((each) => each.install === chosen) ?? installs[0];
  if (!explained.data) return null;
  if (!install) {
    return (
      <Reading.Root>
        <Reading.Title>Runners</Reading.Title>
        <p className="text-muted-foreground">No machine reports its runners. They show here while Runnerbox runs on it.</p>
      </Reading.Root>
    );
  }
  const now = Date.parse(explained.data.at);
  return (
    <ThreadColumn key={install.install} subject={{ _tag: "runners", install: install.install }} placeholder="Ask about these runners">
      {(thread) => (
        <Reading.Root className={cn("transition-opacity duration-200", explained.isPlaceholderData && "opacity-60")}>
          <Reading.Header>
            <Reading.Title>Runners</Reading.Title>
            {installs.length > 1 ? (
              <div className="flex flex-wrap gap-3">
                {installs.map((each) => (
                  <button key={each.install} type="button" className={each.install === install.install ? "text-foreground" : "text-muted-foreground hover:text-foreground"} onClick={() => setChosen(each.install)}>
                    {each.install}
                  </button>
                ))}
              </div>
            ) : null}
          </Reading.Header>
          <p className="text-[15px] leading-relaxed">{install.headline}</p>
          {thread.view.items.length === 0 && thread.permitted && thread.provider?.available ? (
            <Reading.Actions>
              <Button onClick={() => void thread.send(RUNNERS_QUESTION)}>Ask the agent to explain</Button>
            </Reading.Actions>
          ) : null}
          <Picture install={install} now={now} />
          <Reading.Section heading="What each kind of runner is doing">
            <KindStories
              kinds={install.kinds}
              live={live?.find((each) => each.install === install.install)}
              now={now}
              typicalBuildMs={(kind) => typicalBuildMs(events.data ?? [], install.install, kind)}
            />
          </Reading.Section>
          <Reading.Section heading="What happened, newest first">
            <Episodes episodes={install.episodes} now={now} />
          </Reading.Section>
        </Reading.Root>
      )}
    </ThreadColumn>
  );
}

// The machine drawn as what it is: its memory, its runners, and their last hour.
function Picture({ install, now }: { install: InstallExplained; now: number }) {
  return (
    <div className={cn("flex flex-col gap-5", install.stale && "opacity-60")}>
      <MemoryBar memory={install.memory} />
      <RunnerTiles runners={install.runners} now={now} />
      <Reading.Section heading="The last hour">
        <LastHour lanes={install.lanes} now={now} />
      </Reading.Section>
    </div>
  );
}
