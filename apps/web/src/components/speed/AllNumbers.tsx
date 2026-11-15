import type { GroupBy, JobSummary } from "@runnerbox/contracts";
import * as Effect from "effect/Effect";
import { useState } from "react";
import { useRpcQuery } from "../../hooks/useRpcQuery.ts";
import { formatDuration, formatMiB, jobName } from "../../lib/format.ts";
import { Heading } from "../Heading.tsx";
import { HeadroomChart } from "../HeadroomChart.tsx";
import { Button } from "../ui/button.tsx";

const th = "py-1.5 pr-3 font-normal text-muted-foreground";
const num = "py-0.5 pr-3 text-right tabular-nums";

// Every figure Speed and cost has, as tables: how long jobs take on each kind of runner, where
// their steps spend it, how much room the machines had, and what the launcher did. Speed and cost
// keeps it folded under its questions, and shows it alone to a server too old for them.
export function AllNumbers({ repo, days }: { readonly repo: string; readonly days: number }) {
  const [by, setBy] = useState<GroupBy>("labels");
  const [picked, setPicked] = useState<JobSummary | null>(null);
  // Each answer carries the repo it's for: a range or grouping change keeps the last answer on
  // screen while the next loads, but another repo's jobs never show under this repo's name.
  const summaryQuery = useRpcQuery(
    ["weekly", repo, days, by],
    (client) => client["history.weeklySummary"]({ repo, days, by }).pipe(Effect.map((answer) => ({ ...answer, repo }))),
    { keepPrevious: true },
  );
  const samples = useRpcQuery(["samples", days], (client) => client["runners.samples"]({ days, maxPoints: 600 }), { keepPrevious: true });
  const summary = summaryQuery.data?.repo === repo ? summaryQuery.data : undefined;
  const jobs = summary?.jobs ?? [];
  const selected = jobs.find((row) => row.job === picked?.job && row.workflow === picked.workflow) ?? jobs[0];
  // Plain values, not `selected!.job` in the closure: React Compiler reads a closure's property
  // accesses during render to memoize it, which would throw before the jobs load.
  const job = selected?.job ?? "";
  const workflow = selected?.workflow ?? null;
  // Carries the job it answers for, so while another job's steps load the heading still names the
  // job whose steps are shown.
  const stepsQuery = useRpcQuery(
    ["steps", repo, days, by, workflow, job],
    (client) =>
      client["history.stepComparison"]({ repo, days, by, job, ...(workflow ? { workflow } : {}) }).pipe(Effect.map((comparison) => ({ ...comparison, of: selected, repo }))),
    { keepPrevious: true },
  );
  const steps = stepsQuery.data?.repo === repo && !(stepsQuery.isPlaceholderData && stepsQuery.data.of === undefined) ? stepsQuery.data : undefined;
  // The three calls answer at different times. Drawn as each arrived, the headroom chart showed
  // under an empty table and was pushed down twice, so the page waits until each has answered
  // once, or failed, so one failure doesn't hide the other two.
  const ready = (summary !== undefined || summaryQuery.isError) && (samples.data !== undefined || samples.isError) && (steps !== undefined || stepsQuery.isError);
  const reloading = summaryQuery.isPlaceholderData || samples.isPlaceholderData || stepsQuery.isPlaceholderData;
  const installs = Map.groupBy(samples.data ?? [], (sample) => sample.install);
  return (
    <div>
      <div className="flex items-center gap-1 text-[13px]">
        <span className="pr-1 text-muted-foreground">Group by</span>
        {(["labels", "runner"] as const).map((option) => (
          <Button key={option} size="sm" variant={option === by ? "secondary" : "ghost-muted"} onClick={() => setBy(option)}>
            {option === "labels" ? "Label" : "Runner name"}
          </Button>
        ))}
      </div>
      {ready ? (
      // While a new range or grouping loads, the last answer stays and dims after 150 ms, so a
      // fast reload never shows.
      <div className={`text-[13px] transition-opacity ${reloading ? "opacity-40 delay-150" : ""}`}>
      <Heading>Jobs by runner time</Heading>
      <table className="w-full border-collapse">
        <thead className="text-left">
          <tr>
            <th className={th}>Job</th><th className={th}>Runner</th>
            <th className={`${th} text-right`}>Ran</th><th className={`${th} text-right`}>Failed</th><th className={`${th} text-right`}>Retry passed</th><th className={`${th} text-right`}>No runner came</th>
            <th className={`${th} text-right`}>Typical</th><th className={`${th} text-right`}>Slowest 10%</th><th className={`${th} text-right`}>Typical wait</th>
            <th className={`${th} text-right`}>VM free, typical</th><th className={`${th} text-right`}>VM swap, high</th><th className={`${th} text-right`}>Total</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((row) => (
            <tr key={`${row.workflow}${row.job}${row.runnerType}`} onClick={() => setPicked(row)} className={row === selected ? "bg-accent" : "hover:bg-surface"}>
              <td className="py-0.5 pr-3 whitespace-nowrap">{jobName(row)}</td>
              <td className="py-0.5 pr-3 whitespace-nowrap">{row.runnerType}</td>
              <td className={num}>{row.ran}</td>
              <td className={`${num} ${row.failed > 0 ? "text-destructive" : "text-muted-foreground"}`}>{row.failed}</td>
              <td className={`${num} ${row.passedOnRetry > 0 ? "text-warning" : "text-muted-foreground"}`}>{row.passedOnRetry}</td>
              <td className={`${num} text-muted-foreground`}>{row.noRunner}</td>
              <td className={num}>{formatDuration(row.p50Ms)}</td>
              <td className={num}>{formatDuration(row.p90Ms)}</td>
              <td className={`${num} text-muted-foreground`}>{formatDuration(row.queueP50Ms)}</td>
              <td className={`${num} text-muted-foreground`}>{formatMiB(row.vmLowP50MiB)}</td>
              <td className={`${num} text-muted-foreground`}>{formatMiB(row.vmSwapP90MiB)}</td>
              <td className={num}>{formatDuration(row.totalMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {summaryQuery.isError ? <p className="text-muted-foreground">Couldn't read the job history.</p> : null}
      {steps?.of ? (
        <>
          <Heading>Steps of {jobName(steps.of)}, typical of passing runs</Heading>
          <table className="border-collapse">
            <thead className="text-left">
              <tr>
                <th className={th}>Step</th>
                {steps.runnerTypes.map((type) => <th key={type} className={`${th} text-right`}>{type}</th>)}
              </tr>
            </thead>
            <tbody>
              {steps.steps.map((step) => {
                const values = Object.values(step.p50MsByRunnerType).filter((value) => value !== null);
                const slowest = values.length > 1 ? Math.max(...values) : null;
                return (
                  <tr key={step.name}>
                    <td className="py-0.5 pr-6">{step.name}</td>
                    {steps.runnerTypes.map((type) => {
                      const value = step.p50MsByRunnerType[type] ?? null;
                      return <td key={type} className={`${num} pl-6 ${value !== null && value === slowest ? "text-warning" : ""}`}>{formatDuration(value)}</td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      ) : null}
      <Heading>Machine headroom</Heading>
      {samples.isError ? <p className="text-muted-foreground">Couldn't read the machine samples.</p> : null}
      {installs.size === 0 && !samples.isError ? <p className="text-muted-foreground">No machine samples. They come from runnerbox up on that machine.</p> : null}
      {[...installs].map(([install, own]) => (
        <div key={install} className="mb-3">
          <div className="pb-1">{install}</div>
          <HeadroomChart samples={own} days={days} />
        </div>
      ))}
      {summary && summary.launcher.length > 0 ? (
        <>
          <Heading>Launcher</Heading>
          <table className="border-collapse">
            <thead className="text-left">
              <tr>
                <th className={th}>Install</th><th className={th}>Kind</th><th className={`${th} text-right`}>Runners</th><th className={`${th} text-right`}>Failed</th>
                <th className={`${th} text-right`}>Released, memory</th><th className={`${th} text-right`}>Released, image</th><th className={`${th} text-right`}>Memory waits</th>
                <th className={`${th} text-right`}>Long memory wait</th><th className={`${th} text-right`}>Builds</th><th className={`${th} text-right`}>Failed builds</th>
              </tr>
            </thead>
            <tbody>
              {summary.launcher.map((row) => (
                <tr key={`${row.install}${row.runnerType}`}>
                  <td className="py-0.5 pr-3">{row.install}</td><td className="py-0.5 pr-3">{row.runnerType}</td>
                  <td className={num}>{row.runners}</td><td className={`${num} ${row.failedRunners > 0 ? "text-destructive" : "text-muted-foreground"}`}>{row.failedRunners}</td>
                  <td className={`${num} text-muted-foreground`}>{row.releasedForMemory}</td><td className={`${num} text-muted-foreground`}>{row.releasedForImage}</td>
                  <td className={`${num} ${row.memoryWaits > 0 ? "text-warning" : "text-muted-foreground"}`}>{row.memoryWaits}</td><td className={`${num} text-muted-foreground`}>{formatDuration(row.memoryWaitP90Ms)}</td>
                  <td className={`${num} text-muted-foreground`}>{row.imageBuilds}</td><td className={`${num} ${row.failedBuilds > 0 ? "text-destructive" : "text-muted-foreground"}`}>{row.failedBuilds}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      </div>
      ) : null}
    </div>
  );
}
