import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import { NoHistory } from "../components/NoHistory.tsx";
import { PageBar } from "../components/PageBar.tsx";
import { PageBody } from "../components/PageBody.tsx";
import { RangeMenu } from "../components/RangeMenu.tsx";
import { RepoPicker } from "../components/RepoPicker.tsx";
import { AllNumbers } from "../components/speed/AllNumbers.tsx";
import { Costs } from "../components/speed/Costs.tsx";
import { Facts } from "../components/speed/Facts.tsx";
import { HealthRows } from "../components/speed/HealthRows.tsx";
import { JobPanel } from "../components/speed/JobPanel.tsx";
import { ALL_MACHINES, MachinePicker } from "../components/speed/MachinePicker.tsx";
import { Savings } from "../components/speed/Savings.tsx";
import { FactsGhost, HealthGhost, SavingsGhost, TimeGhost, WaitGhost } from "../components/speed/SpeedGhosts.tsx";
import { Section } from "../components/speed/Section.tsx";
import { TimeByJob, trendKey } from "../components/speed/TimeByJob.tsx";
import { WaitGrid } from "../components/speed/WaitGrid.tsx";
import { waitGrid, waitSentence } from "../components/speed/waitsByHour.ts";
import { hours, rangeWords } from "../components/speed/words.ts";
import { useActiveEnvironment } from "../hooks/useEnvironment.ts";
import { useInbox } from "../hooks/useInbox.ts";
import { useKept } from "../hooks/useKept.ts";
import { useRange } from "../hooks/useRange.ts";
import { useRepo } from "../hooks/useRepo.ts";
import { useRuns } from "../hooks/useRuns.ts";
import { useServerCapabilityState } from "../hooks/useServerCapabilities.ts";
import { answerOf } from "../lib/answer.ts";
import { dailyTotalsEverywhereAtom } from "../state/history.ts";
import { healthEverywhereAtom, jobTrendsAtom, kindUsageEverywhereAtom, overviewAtom } from "../state/speed.ts";

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
  const { capabilities, known } = useServerCapabilityState();
  const { environment } = useActiveEnvironment();
  const [machine, setMachine] = useState(ALL_MACHINES);
  const [picked, setPicked] = useState<string | null>(null);
  const environmentId = environment?.environmentId ?? "";
  const usage = useAtomValue(kindUsageEverywhereAtom(days));
  const health = useAtomValue(healthEverywhereAtom(HEALTH_DAYS));
  // Each machine runs its own reviews on its own Claude account, so their cost adds up across machines.
  const totals = useAtomValue(dailyTotalsEverywhereAtom({ days, repo: null }));
  const repoTotals = useAtomValue(dailyTotalsEverywhereAtom({ days, repo: repo ?? null }));
  // Carries its repo, so a range change keeps it on screen while the next loads but another repo's
  // jobs never show under this repo's name.
  const trendsQuery = useKept(answerOf(useAtomValue(jobTrendsAtom({ environmentId, repo, days }))));
  // The same runs atom All runs reads.
  const runs = useRuns(repo, days);
  const overview = useKept(answerOf(useAtomValue(overviewAtom({ environmentId, days }))));
  const inbox = useInbox();
  const bar = (
    <PageBar title="Speed and cost">
      <MachinePicker value={machine === ALL_MACHINES ? ALL_MACHINES : (environment?.environmentId ?? ALL_MACHINES)} onChange={setMachine} />
      <RepoPicker />
      <RangeMenu />
    </PageBar>
  );
  if (loaded && !repo) {
    return (
      <>
        {bar}
        <PageBody width="wide">
          <NoHistory />
        </PageBody>
      </>
    );
  }
  // Only a server that has said it's older gets the tables alone; before it answers, the page holds
  // the shape a current server fills.
  if (known && !capabilities.speed) {
    return (
      <>
        {bar}
        <PageBody width="wide">{repo ? <AllNumbers repo={repo} days={days} /> : null}</PageBody>
      </>
    );
  }
  // One machine picked follows the active one, so the sidebar's switcher moves it too.
  const shown = (environmentId: string) => machine === ALL_MACHINES || environmentId === environment?.environmentId;
  const answered = usage.flatMap((answer) => (answer.data && shown(answer.environment.environmentId) ? [{ environmentId: answer.environment.environmentId, label: answer.environment.label, report: answer.data }] : []));
  const reports = answered.map((answer) => answer.report);
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
  // Runner time above is each picked machine's own; GitHub's time is only in job history, so the
  // share compares the two sides of the same history rather than mixing the scopes.
  const historyMs = summary ? summary.ownMachinesMs + summary.githubMachinesMs : 0;
  const ownShare = summary && historyMs > 0 ? summary.ownMachinesMs / historyMs : null;
  const spend = (answers: typeof totals) => {
    const reviewDays = answers.flatMap((answer) => (answer.data && shown(answer.environment.environmentId) ? answer.data : []));
    return { reviews: reviewDays.reduce((total, day) => total + day.reviews, 0), usd: reviewDays.reduce((total, day) => total + day.reviewCostUsd, 0) };
  };
  const allSpend = spend(totals);
  const repoSpend = spend(repoTotals);
  const reviews = allSpend.reviews > 0 || allSpend.usd > 0 ? { ...allSpend, repo: repo && repoTotals.some((answer) => answer.data) && repoSpend.usd !== allSpend.usd ? { name: repo, ...repoSpend } : null } : null;
  // The repository the answers are for, once they're all in; until then, the page holds its shape.
  const shownRepo = ready ? repo : undefined;
  return (
    <>
      {bar}
      <PageBody width="wide">
        {/* The sections draw at once and their insides fill in together, so the page keeps its
            shape as answers arrive. While a new range loads, the last answer stays and dims after
            150 ms, so a fast reload never shows. */}
        <div className={`flex flex-col gap-10 transition-opacity ${reloading ? "opacity-40 delay-150" : ""}`}>
          <div className="flex flex-col gap-7">
            {shownRepo ? <Savings usd={priced.length > 0 ? priced.reduce((total, usd) => total + usd, 0) : null} ownMs={ownMs} pricesReadOn={reports[0]?.pricesReadOn ?? null} days={days} reviewUsd={reviews?.usd ?? null} /> : <SavingsGhost />}
            {shownRepo ? <Facts ownMs={ownMs} githubMs={summary?.githubMachinesMs ?? null} ownShare={ownShare} typicalJobMs={overview.data?.p50Ms ?? null} typicalWaitMs={summary?.typicalWaitMs ?? null} /> : <FactsGhost />}
          </div>
          <Section title="Health, machine by machine" note={`last ${HEALTH_DAYS} days`}>
            {shownRepo ? (
              <HealthRows
                length={HEALTH_DAYS}
                machines={health.flatMap((answer) =>
                  shown(answer.environment.environmentId) ? [{ environmentId: answer.environment.environmentId, label: answer.environment.label, health: answer.data, isError: answer.isError }] : [],
                )}
              />
            ) : (
              <HealthGhost />
            )}
          </Section>
          <Section title="Where the time goes" note={shownRepo && trends && trends.length > 0 ? `${hours(trends.reduce((total, trend) => total + trend.runnerMs, 0))} on ${trends.length} jobs` : undefined}>
            {shownRepo ? (
              <div className="grid gap-x-10 gap-y-6 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <TimeByJob trends={trends ?? []} picked={pickedTrend ? trendKey(pickedTrend) : null} onPick={setPicked} />
                {pickedTrend ? <JobPanel trend={pickedTrend} runs={runs.data} repo={shownRepo} days={days} /> : null}
              </div>
            ) : (
              <TimeGhost />
            )}
          </Section>
          <Section title="When jobs wait for a runner" note="typical wait, by weekday and hour">
            {!shownRepo ? (
              <WaitGhost />
            ) : runs.data && runs.data.length > 0 ? (
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
          {shownRepo && reports[0] && (priced.length > 0 || reviews) ? (
            <Section title="What it costs" note={rangeWords(days)}>
              <Costs machines={answered.map(({ report, ...machine }) => ({ ...machine, kinds: report.kinds }))} pricesReadOn={reports[0].pricesReadOn} reviews={reviews} />
            </Section>
          ) : null}
          {repo ? (
            <details>
              <summary className="cursor-default text-muted-foreground">All numbers</summary>
              <div className="pt-2">
                <AllNumbers repo={repo} days={days} />
              </div>
            </details>
          ) : null}
        </div>
      </PageBody>
    </>
  );
}
