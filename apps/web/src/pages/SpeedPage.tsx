import * as Effect from "effect/Effect";
import { useState } from "react";
import { NoHistory } from "../components/NoHistory.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { RepoPicker } from "../components/RepoPicker.tsx";
import { AllNumbers } from "../components/speed/AllNumbers.tsx";
import { Facts } from "../components/speed/Facts.tsx";
import { JobPanel } from "../components/speed/JobPanel.tsx";
import { KindWaits } from "../components/speed/KindWaits.tsx";
import { MachineRoom } from "../components/speed/MachineRoom.tsx";
import { TimeByJob, trendKey } from "../components/speed/TimeByJob.tsx";
import { useInbox } from "../hooks/useInbox.ts";
import { useRange } from "../hooks/useRange.ts";
import { useRepo } from "../hooks/useRepo.ts";
import { useRpcQuery } from "../hooks/useRpcQuery.ts";
import { useServerCapabilities } from "../hooks/useServerCapabilities.ts";

const Question = ({ title, children }: { readonly title: string; readonly children: React.ReactNode }) => (
  <section className="flex flex-col gap-2">
    <h2 className="text-sm font-medium">{title}</h2>
    {children}
  </section>
);

// Speed and cost as three questions, each with one picture and a sentence by the server's rules:
// where the time goes, whether jobs wait for a runner, and whether the machine is big enough. The
// tables fold away under them. A server too old for the questions gets the tables alone.
export function SpeedPage() {
  const { days } = useRange();
  const { repo, loaded } = useRepo();
  const { speed } = useServerCapabilities();
  const [picked, setPicked] = useState<string | null>(null);
  const usage = useRpcQuery(["kindUsage", days], (client) => client["history.kindUsage"]({ days }), { keepPrevious: true, enabled: speed });
  // Carries its repo, so a range change keeps it on screen while the next loads but another repo's
  // jobs never show under this repo's name.
  const trendsQuery = useRpcQuery(
    ["jobTrends", repo, days],
    (client) => client["history.jobTrends"]({ repo: repo!, days }).pipe(Effect.map((trends) => ({ trends, repo }))),
    { keepPrevious: true, enabled: speed && repo !== undefined },
  );
  const samples = useRpcQuery(["samples", days], (client) => client["runners.samples"]({ days, maxPoints: 600 }), { keepPrevious: true, enabled: speed });
  const overview = useRpcQuery(["overview", days], (client) => client["history.overview"]({ days }), { keepPrevious: true, enabled: speed });
  const inbox = useInbox();
  if (loaded && !repo) return <NoHistory />;
  const header = (
    <PageHeader.Root>
      <PageHeader.Title>Speed and cost</PageHeader.Title>
      <RepoPicker />
    </PageHeader.Root>
  );
  if (!speed) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        {header}
        <div className="px-6">{repo ? <AllNumbers repo={repo} days={days} /> : null}</div>
      </div>
    );
  }
  const trends = trendsQuery.data !== undefined && trendsQuery.data.repo === repo ? trendsQuery.data.trends : undefined;
  const settled = (query: { data: unknown; isError: boolean }) => query.data !== undefined || query.isError;
  // Each call answers in its own time; the page waits for all of them once, then updates in place.
  const ready = settled(usage) && (trends !== undefined || trendsQuery.isError) && settled(samples) && settled(overview) && settled(inbox);
  const reloading = usage.isPlaceholderData || trendsQuery.isPlaceholderData || samples.isPlaceholderData || overview.isPlaceholderData;
  const pickedTrend = trends?.find((trend) => trendKey(trend) === picked);
  // A server one release older answers without `machines`: each sampled machine still gets its
  // graph, with no sentence, since the rules that write it live on the server.
  const fits =
    usage.data?.machines ??
    [...Map.groupBy(samples.data ?? [], (sample) => sample.install)].map(([install, own]) => ({
      install,
      floorMiB: null,
      lowestMiB: null,
      totalMiB: Math.max(0, ...own.map((sample) => sample.vm?.totalMiB ?? 0)),
      sentence: "",
    }));
  const summary = inbox.data?.summary;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-6">
      {header}
      {ready && repo ? (
        // While a new range loads, the last answer stays and dims after 150 ms, so a fast reload never shows.
        <div className={`flex flex-col gap-7 px-6 text-[13px] transition-opacity ${reloading ? "opacity-40 delay-150" : ""}`}>
          <Facts
            ownMs={summary?.ownMachinesMs ?? 0}
            githubMs={summary?.githubMachinesMs ?? 0}
            typicalJobMs={overview.data?.p50Ms ?? null}
            typicalWaitMs={summary?.typicalWaitMs ?? null}
            cost={usage.data?.totalCost ?? null}
            pricesReadOn={usage.data?.pricesReadOn ?? null}
          />
          <Question title="Where does the time go?">
            <div className="grid gap-6 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
              <div className="flex min-w-0 flex-col gap-2">
                <TimeByJob trends={trends ?? []} picked={picked} onPick={(key) => setPicked(key === picked ? null : key)} />
                {pickedTrend ? null : <p className="text-muted-foreground">Pick a job to see its steps and a typical run's memory and CPU.</p>}
              </div>
              {pickedTrend ? <JobPanel trend={pickedTrend} repo={repo} days={days} /> : null}
            </div>
          </Question>
          <Question title="Do jobs wait for a runner?">
            <KindWaits kinds={usage.data?.kinds ?? []} />
          </Question>
          <Question title="Is the machine big enough?">
            <MachineRoom fits={fits} samples={samples.data ?? []} days={days} now={usage.data ? Date.parse(usage.data.until) : 0} />
          </Question>
          <details>
            <summary className="cursor-default text-sm font-medium">All numbers</summary>
            <div className="pt-2">
              <AllNumbers repo={repo} days={days} />
            </div>
          </details>
        </div>
      ) : null}
    </div>
  );
}
