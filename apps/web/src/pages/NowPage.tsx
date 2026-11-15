import { Link } from "@tanstack/react-router";
import { Heading } from "../components/Heading.tsx";
import { LastHour } from "../components/now/LastHour.tsx";
import { MachineNow } from "../components/now/MachineNow.tsx";
import { PinnedItems } from "../components/now/PinnedItems.tsx";
import { SlotRows } from "../components/now/SlotRows.tsx";
import { WaitingJobs } from "../components/now/WaitingJobs.tsx";
import { useInbox } from "../hooks/useInbox.ts";
import { useRepo } from "../hooks/useRepo.ts";
import { useRpcQuery } from "../hooks/useRpcQuery.ts";
import { useRunnerQueue } from "../hooks/useRunnerQueue.ts";
import { listening, useRunnerState } from "../hooks/useRunnerState.ts";
import { typicalBuildMs } from "../lib/imageFacts.ts";
import { lanes, lastHour } from "../lib/now.ts";
import type { RootSearch } from "../lib/search.ts";

const keep = (previous: RootSearch) => previous;

// What's happening on the machine right now, made to sit in a narrow window beside the editor:
// what needs the owner first, then the runners, what just finished, and the machine itself.
export function NowPage() {
  const installs = useRunnerState();
  const queue = useRunnerQueue();
  const inbox = useInbox().data;
  const { repo } = useRepo();
  // Finished things change by the minute at most: runners ending, samples, and synced jobs.
  const events = useRpcQuery(["events", 1], (client) => client["runners.events"]({ days: 1 }), { refetchEvery: 30_000 }).data ?? [];
  const samples = useRpcQuery(["samples", 1], (client) => client["runners.samples"]({ days: 1, maxPoints: 1440 }), { refetchEvery: 60_000 }).data ?? [];
  const runs =
    useRpcQuery(["runs", repo, 1], (client) => client["history.runs"]({ repo: repo!, days: 1, limit: 500 }), { enabled: repo !== undefined, refetchEvery: 60_000 }).data ?? [];
  const live = installs?.filter((install) => !install.stale) ?? [];
  // Measured from the machine's last report, so the view moves with the data and renders purely.
  // With no report, nothing counts as the last hour.
  const now = Math.max(0, ...live.map((install) => Date.parse(install.updatedAt)));
  const runnerNames = new Set(events.flatMap((event) => (event.event === "runner" ? [event.runner] : [])));
  const { online, total } = listening(live);
  const busy = live.flatMap((install) => install.kinds.flatMap((kind) => kind.slots)).filter((slot) => slot.phase === "busy").length;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-1 px-4 pt-4 pb-8 text-[13px] sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h1 className="font-medium text-base">Now</h1>
          {total > 0 ? (
            <span className="text-muted-foreground">
              {busy} of {total} busy{online < total ? `, ${total - online} not taking jobs` : ""}
            </span>
          ) : null}
        </div>
        {installs && live.length === 0 ? (
          <p className="pt-2 text-muted-foreground">Runnerbox isn't running on this machine, or hasn't reported for a while.</p>
        ) : null}
        {inbox ? (
          <div className="pt-3">
            <PinnedItems inbox={inbox} now={now} />
          </div>
        ) : null}
        {live.map((install) => (
          <div key={install.install}>
            <Heading>{live.length > 1 ? `Runners on ${install.install}` : "Runners"}</Heading>
            <SlotRows install={install} now={now} />
          </div>
        ))}
        {queue && queue.status !== "off" && live.length > 0 ? (
          <>
            <Heading>{queue.waiting.length > 0 ? `Waiting for a runner, ${queue.waiting.length}` : "Waiting for a runner"}</Heading>
            <WaitingJobs queue={queue} now={now} />
          </>
        ) : null}
        {repo && live.length > 0 ? (
          <>
            <Heading>Last hour in {repo}</Heading>
            <LastHour runs={lastHour(runs, runnerNames, now)} />
          </>
        ) : null}
        {live.map((install) => (
          <div key={`${install.install}-machine`}>
            <Heading>{live.length > 1 ? `The machine, ${install.install}` : "The machine"}</Heading>
            <MachineNow
              install={install}
              sample={samples.findLast((sample) => sample.install === install.install)}
              lanes={lanes([install], events, runs, now)}
              now={now}
              typicalBuildMs={(kind) => typicalBuildMs(events, install.install, kind)}
            />
          </div>
        ))}
        <p className="pt-6 text-muted-foreground">
          More on <Link to="/runners" search={keep} className="underline-offset-2 hover:text-foreground hover:underline">Runners</Link> and{" "}
          <Link to="/" search={keep} className="underline-offset-2 hover:text-foreground hover:underline">the weekly summary</Link>.
        </p>
      </div>
    </div>
  );
}
