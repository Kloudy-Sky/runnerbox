import { useNow } from "../../hooks/useNow.ts";
import type { OverviewMachine } from "../../hooks/useOverview.ts";
import type { RunnerMachine } from "../../state/runnerMachines.ts";
import { formatDuration } from "../../lib/format.ts";
import { machineTrouble } from "../../lib/machineTrouble.ts";
import { cn } from "../../lib/utils.ts";
import { waitingEverywhere, waitingKey } from "../../lib/waitingEverywhere.ts";
import { RunnerBays } from "../runners/RunnerBays.tsx";
import { OverviewSection } from "./OverviewSection.tsx";
import { RankedList } from "./RankedList.tsx";

const WAITING_SHOWN = 3;
const TONE = { bad: "text-destructive", waiting: "text-warning", quiet: "text-muted-foreground" } as const;

// Each machine's runners as the Runners page draws them, with what's wrong in a few words, then the
// jobs waiting longest for a runner on any of them.
export function RunnersNow({ runners, machines }: { runners: ReadonlyArray<RunnerMachine>; machines: ReadonlyArray<OverviewMachine> }) {
  const now = useNow(10_000);
  const tiles = runners.flatMap((runner) => (runner.install && !runner.install.stale ? runner.install.runners : []));
  const queues = machines.flatMap((machine) => (machine.queue && machine.queue.status !== "off" ? [{ key: machine.environmentId, machine: null, queue: machine.queue }] : []));
  const waiting = waitingEverywhere(queues);
  return (
    <OverviewSection title="Runners now" aside={tiles.length > 0 ? `${tiles.filter((tile) => tile.state === "running").length} of ${tiles.length} working` : null}>
      <div className="flex flex-col gap-4">
        {runners.map((runner) => {
          const trouble = runner.install ? machineTrouble(runner.install, runner.connection) : null;
          return (
            <div key={runner.key} className={cn(runner.install?.stale && "opacity-70")}>
              <div className="flex justify-between gap-2.5 pb-1.5">
                <span className="truncate font-semibold">{runner.name}</span>
                {trouble ? <span className={TONE[trouble.tone]}>{trouble.note}</span> : runner.note ? <span className="text-muted-foreground">{runner.note}</span> : null}
              </div>
              {runner.install ? (
                <RunnerBays runners={runner.install.runners} running={machines.find((machine) => machine.environmentId === runner.environmentId)?.queue?.running ?? []} now={runner.now} small />
              ) : null}
            </div>
          );
        })}
      </div>
      <RankedList
        heading="Waiting for a runner"
        rows={waiting.slice(0, WAITING_SHOWN).map(({ job }) => ({
          key: waitingKey(job),
          label: `${job.job} · ${job.repo}`,
          value: formatDuration(Math.max(0, now - Date.parse(job.since))),
        }))}
      />
      {queues.length > 0 && waiting.length === 0 ? <p className="pt-3.5 text-muted-foreground">Nothing is waiting for a runner.</p> : null}
    </OverviewSection>
  );
}
