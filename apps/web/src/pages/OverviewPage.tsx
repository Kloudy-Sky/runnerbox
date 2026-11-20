import { useNavigate } from "@tanstack/react-router";
import { JobsEachDay } from "../components/overview/JobsEachDay.tsx";
import { OverviewInbox } from "../components/overview/OverviewInbox.tsx";
import { OverviewTotals } from "../components/overview/OverviewTotals.tsx";
import { PullsNow } from "../components/overview/PullsNow.tsx";
import { RANGE_WORDS } from "../components/overview/rangeWords.ts";
import { ReviewsEachDay } from "../components/overview/ReviewsEachDay.tsx";
import { RepoFilter } from "../components/overview/RepoFilter.tsx";
import { ReviewTime } from "../components/overview/ReviewTime.tsx";
import { RunnersNow } from "../components/overview/RunnersNow.tsx";
import { WaitEachDay } from "../components/overview/WaitEachDay.tsx";
import { PageBar } from "../components/PageBar.tsx";
import { PageBody } from "../components/PageBody.tsx";
import { RangeMenu } from "../components/RangeMenu.tsx";
import { MachineFilter } from "../components/runners/MachineFilter.tsx";
import { useOverview } from "../hooks/useOverview.ts";
import { useRange } from "../hooks/useRange.ts";
import { addMachines, addTotals, comparedPeriods, rangeDays } from "../lib/addTotals.ts";
import type { RootSearch } from "../lib/search.ts";

// The page the app opens on, across every connected machine: what needs the owner first, then the
// range's totals, then what's happening now and day by day. A machine that's offline, or too old to
// report daily totals, is named at the top and never blanks the page.
export function OverviewPage() {
  const navigate = useNavigate();
  const { range, days: length } = useRange();
  const { runners, picked, machines, shownRunners, repo, repos, pulls, pullsLoaded, inbox } = useOverview();
  const words = RANGE_WORDS[range];
  const all = addMachines(machines.map((machine) => machine.days));
  const current = rangeDays(all, length);
  const byMachine = machines.flatMap((machine) => (machine.days ? [{ environmentId: machine.environmentId, label: machine.label, days: rangeDays(machine.days, length) }] : []));
  // The usual level is the typical time over the whole window: the range and the period before it.
  const usual = addTotals(all);
  const offline = machines.filter((machine) => !machine.online).map((machine) => machine.label);
  const old = machines.filter((machine) => machine.online && machine.noTotals).map((machine) => machine.label);
  return (
    <>
      <PageBar title="Overview">
        {runners.length > 1 ? <MachineFilter machines={runners} picked={picked?.key ?? null} onPick={(machine) => void navigate({ to: ".", search: (previous: RootSearch) => ({ ...previous, machine: machine?.key }) })} /> : null}
        {repos.length > 1 || repo ? <RepoFilter repos={repos} picked={repo} onPick={(picked) => void navigate({ to: ".", search: (previous: RootSearch) => ({ ...previous, repo: picked ?? undefined }) })} /> : null}
        <RangeMenu />
      </PageBar>
      <PageBody width="expanded" className="@container gap-10">
        {offline.length > 0 || old.length > 0 ? (
          <div className="flex flex-col text-muted-foreground text-xs">
            {offline.length > 0 ? <span>{offline.join(", ")} offline</span> : null}
            {old.length > 0 ? <span>{old.join(", ")}: too old for daily totals. Update from Settings, under About.</span> : null}
          </div>
        ) : null}
        <OverviewInbox rows={inbox.rows} machines={inbox.machines} />
        <OverviewTotals current={addTotals(current)} compared={comparedPeriods(all, length)} before={words.before} />
        <div className="grid gap-x-12 gap-y-11 @3xl:grid-cols-2">
          <RunnersNow runners={shownRunners} machines={machines} />
          <PullsNow pulls={pulls} loaded={pullsLoaded} />
          <JobsEachDay days={current} byMachine={byMachine} range={words.now} />
          <ReviewsEachDay days={current} pulls={pulls} range={words.now} />
          <WaitEachDay days={current} usual={usual.typicalWaitMs} byMachine={byMachine} range={words.now} />
          <ReviewTime days={current} usual={usual.typicalReviewMs} range={words.now} />
        </div>
      </PageBody>
    </>
  );
}
