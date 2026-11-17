import * as Effect from "effect/Effect";
import { useState } from "react";
import { NoHistory } from "../components/NoHistory.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { RepoPicker } from "../components/RepoPicker.tsx";
import { AllNumbers } from "../components/speed/AllNumbers.tsx";
import { Facts } from "../components/speed/Facts.tsx";
import { HealthRows } from "../components/speed/HealthRows.tsx";
import { JobPanel } from "../components/speed/JobPanel.tsx";
import { ALL_MACHINES, MachinePicker } from "../components/speed/MachinePicker.tsx";
import { Savings } from "../components/speed/Savings.tsx";
import { Section } from "../components/speed/Section.tsx";
import { TimeByJob, trendKey } from "../components/speed/TimeByJob.tsx";
import { WaitGrid } from "../components/speed/WaitGrid.tsx";
import { waitGrid, waitSentence } from "../components/speed/waitsByHour.ts";
import { hours } from "../components/speed/words.ts";
import { useActiveEnvironment } from "../hooks/useEnvironment.ts";
import { useInbox } from "../hooks/useInbox.ts";
import { useRange } from "../hooks/useRange.ts";
import { useRepo } from "../hooks/useRepo.ts";
import { useRpcQuery } from "../hooks/useRpcQuery.ts";
import { useRpcQueryEverywhere } from "../hooks/useRpcQueryEverywhere.ts";
import { useServerCapabilities } from "../hooks/useServerCapabilities.ts";

// Health always looks back a month, whatever the range: a laptop's week of nights and weekends
// only reads as a pattern over several.
const HEALTH_DAYS = 30;

// Speed and cost leads with what the owner's machines saved, then the totals, each machine's
// health, where the time goes and when jobs wait. The tables fold away at the bottom.
// What each machine measures itself (its runners' time, cost and health) is read from every machine
// picked and added up. Job history is the same on every machine that syncs a repository, so it's
// read from the active one alone, which picking a machine changes. A server too old for any of
// this gets the tables alone.
export function SpeedPage() {
  const { days } = useRange();
  const { repo, loaded } = useRepo();
  const { speed } = useServerCapabilities();
  const { environment } = useActiveEnvironment();
  const [machine, setMachine] = useState(ALL_MACHINES);
  const [picked, setPicked] = useState<string | null>(null);
  const usage = useRpcQueryEverywhere(["kindUsage", days], (client) => client["history.kindUsage"]({ days }));
  const health = useRpcQueryEverywhere(["health", HEALTH_DAYS], (client) => client["runners.health"]({ days: HEALTH_DAYS }));
  // Carries its repo, so a range change keeps it on screen while the next loads but another repo's
  // jobs never show under this repo's name.
  const trendsQuery = useRpcQuery(
    ["jobTrends", repo, days],
    (client) => client["history.jobTrends"]({ repo: repo!, days }).pipe(Effect.map((trends) => ({ trends, repo }))),
    { keepPrevious: true, enabled: speed && repo !== undefined },
  );
  // The same call, and so the same cache, as the run list.
  const runs = useRpcQuery(["runs", repo, days], (client) => client["history.runs"]({ repo: repo!, days, limit: 2000 }), { enabled: repo !== undefined });
  const overview = useRpcQuery(["overview", days], (client) => client["history.overview"]({ days }), { keepPrevious: true, enabled: speed });
  const inbox = useInbox();
  if (loaded && !repo) return <NoHistory />;
  const header = (
    <PageHeader.Root>
      <PageHeader.Title>Speed and cost</PageHeader.Title>
      <PageHeader.Spacer />
      {/* The filters sit in one row at their own width, where a picker alone would fill it. */}
      <div className="flex flex-wrap items-center gap-2 [&_[data-slot=select-trigger]]:w-auto">
        <MachinePicker value={machine === ALL_MACHINES ? ALL_MACHINES : (environment?.environmentId ?? ALL_MACHINES)} onChange={setMachine} />
        <RepoPicker />
      </div>
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
  // One machine picked follows the active one, so the sidebar's switcher moves it too.
  const shown = (environmentId: string) => machine === ALL_MACHINES || environmentId === environment?.environmentId;
  const reports = usage.flatMap((answer) => (answer.data && shown(answer.environment.environmentId) ? [answer.data] : []));
  const kinds = reports.flatMap((report) => report.kinds);
  const priced = reports.flatMap((report) => (report.totalCost ? [report.totalCost.usd] : []));
  const ownMs = kinds.reduce((total, kind) => total + kind.runnerMs, 0);
  const trends = trendsQuery.data !== undefined && trendsQuery.data.repo === repo ? trendsQuery.data.trends : undefined;
  const settled = (query: { data: unknown; isError: boolean }) => query.data !== undefined || query.isError;
  const active = usage.find((answer) => answer.environment.environmentId === environment?.environmentId);
  // The active machine's answers come once, then the page updates in place; other machines fill in
  // as they answer, and one that's offline never holds the page back.
  const ready = (active === undefined || settled(active)) && (trends !== undefined || trendsQuery.isError) && settled(runs) && settled(overview) && settled(inbox);
  const reloading = trendsQuery.isPlaceholderData || overview.isPlaceholderData;
  const pickedTrend = trends?.find((trend) => trendKey(trend) === picked) ?? trends?.[0];
  const grid = waitGrid(runs.data ?? []);
  // Two machines serving the same label can name the same bottleneck, so each sentence shows once.
  const sentences = new Set([waitSentence(grid), ...kinds.flatMap((kind) => (kind.bottleneck ? [kind.bottleneck.text] : []))].filter((sentence) => sentence !== null));
  const summary = inbox.data?.summary;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-10">
      {header}
      {ready && repo ? (
        // While a new range loads, the last answer stays and dims after 150 ms, so a fast reload never shows.
        <div className={`flex flex-col gap-10 px-6 pt-2 text-[13px] transition-opacity ${reloading ? "opacity-40 delay-150" : ""}`}>
          <div className="flex flex-col gap-7">
            <Savings usd={priced.length > 0 ? priced.reduce((total, usd) => total + usd, 0) : null} ownMs={ownMs} pricesReadOn={reports[0]?.pricesReadOn ?? null} days={days} />
            <Facts ownMs={ownMs} githubMs={summary?.githubMachinesMs ?? null} typicalJobMs={overview.data?.p50Ms ?? null} typicalWaitMs={summary?.typicalWaitMs ?? null} />
          </div>
          <Section title="Health, machine by machine" note={`last ${HEALTH_DAYS} days`}>
            <HealthRows
              length={HEALTH_DAYS}
              machines={health.flatMap((answer) =>
                shown(answer.environment.environmentId) ? [{ environmentId: answer.environment.environmentId, label: answer.environment.label, health: answer.data, isError: answer.isError }] : [],
              )}
            />
          </Section>
          <Section title="Where the time goes" note={trends && trends.length > 0 ? `${hours(trends.reduce((total, trend) => total + trend.runnerMs, 0))} on ${trends.length} jobs` : undefined}>
            <div className="grid gap-x-10 gap-y-6 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <TimeByJob trends={trends ?? []} picked={pickedTrend ? trendKey(pickedTrend) : null} onPick={setPicked} />
              {pickedTrend ? <JobPanel trend={pickedTrend} runs={runs.data} repo={repo} days={days} /> : null}
            </div>
          </Section>
          <Section title="When jobs wait for a runner" note="typical wait, by weekday and hour">
            {runs.data && runs.data.length > 0 ? (
              <div className="grid items-start gap-x-10 gap-y-4 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <WaitGrid grid={grid} />
                <div className="flex flex-col gap-2 text-foreground/90">
                  {[...sentences].map((sentence) => (
                    <p key={sentence}>{sentence}</p>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground">{runs.isError ? "Couldn't read the job history." : "No jobs ran in this repository in this time."}</p>
            )}
          </Section>
          <details>
            <summary className="cursor-default text-muted-foreground">All numbers</summary>
            <div className="pt-2">
              <AllNumbers repo={repo} days={days} />
            </div>
          </details>
        </div>
      ) : null}
    </div>
  );
}
