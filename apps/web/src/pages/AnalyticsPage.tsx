import type { GroupBy, JobSummary } from "@runnerbox/contracts";
import { useState } from "react";
import { NoHistory } from "../components/NoHistory.tsx";
import { Heading } from "../components/Heading.tsx";
import { HeadroomChart } from "../components/HeadroomChart.tsx";
import { RepoPicker } from "../components/RepoPicker.tsx";
import { useRange } from "../hooks/useRange.ts";
import { useRepo } from "../hooks/useRepo.ts";
import { useRpcQuery } from "../hooks/useRpcQuery.ts";
import { formatDuration, formatMiB, jobName } from "../lib/format.ts";

const th = "py-1 pr-3 font-medium";
const num = "py-0.5 pr-3 text-right tabular-nums";

export function AnalyticsPage() {
  const { days } = useRange();
  const { repo, loaded } = useRepo();
  const [by, setBy] = useState<GroupBy>("labels");
  const [picked, setPicked] = useState<JobSummary | null>(null);
  const summary = useRpcQuery(["weekly", repo, days, by], (client) => client["history.weeklySummary"]({ repo: repo!, days, by }));
  const samples = useRpcQuery(["samples", days], (client) => client["runners.samples"]({ days, maxPoints: 600 }));
  const jobs = summary.data?.jobs ?? [];
  const selected = jobs.find((row) => row.job === picked?.job && row.workflow === picked.workflow) ?? jobs[0];
  const steps = useRpcQuery(["steps", repo, days, by, selected?.workflow, selected?.job], (client) =>
    client["history.stepComparison"]({ repo: repo!, days, by, job: selected!.job, ...(selected?.workflow ? { workflow: selected.workflow } : {}) }),
  );
  if (loaded && !repo) return <NoHistory />;
  const installs = Map.groupBy(samples.data ?? [], (sample) => sample.install);
  return (
    <div className="px-3 py-2">
      <div className="flex items-baseline gap-4">
        <RepoPicker />
        <span className="flex-1" />
        <span className="text-dim">group by</span>
        {(["labels", "runner"] as const).map((option) => (
          <button type="button" key={option} onClick={() => setBy(option)} className={option === by ? "text-fg" : "text-dim hover:text-fg"}>
            {option === "labels" ? "label" : "runner name"}
          </button>
        ))}
      </div>
      <Heading>Jobs by runner time</Heading>
      <table className="w-full border-collapse">
        <thead className="text-left text-[11px] tracking-wide text-dim uppercase">
          <tr>
            <th className={th}>Job</th><th className={th}>Runner</th>
            <th className={`${th} text-right`}>Ran</th><th className={`${th} text-right`}>Failed</th><th className={`${th} text-right`}>Retry passed</th><th className={`${th} text-right`}>No runner</th>
            <th className={`${th} text-right`}>P50</th><th className={`${th} text-right`}>P90</th><th className={`${th} text-right`}>Queue P50</th>
            <th className={`${th} text-right`}>VM low P50</th><th className={`${th} text-right`}>VM swap P90</th><th className={`${th} text-right`}>Total</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((row) => (
            <tr key={`${row.workflow}${row.job}${row.runnerType}`} onClick={() => setPicked(row)} className={row === selected ? "bg-surf2" : "hover:bg-surf"}>
              <td className="py-0.5 pr-3 whitespace-nowrap">{jobName(row)}</td>
              <td className="py-0.5 pr-3 whitespace-nowrap">{row.runnerType}</td>
              <td className={num}>{row.ran}</td>
              <td className={`${num} ${row.failed > 0 ? "text-red" : "text-dim"}`}>{row.failed}</td>
              <td className={`${num} ${row.passedOnRetry > 0 ? "text-amber" : "text-dim"}`}>{row.passedOnRetry}</td>
              <td className={`${num} text-dim`}>{row.noRunner}</td>
              <td className={num}>{formatDuration(row.p50Ms)}</td>
              <td className={num}>{formatDuration(row.p90Ms)}</td>
              <td className={`${num} text-dim`}>{formatDuration(row.queueP50Ms)}</td>
              <td className={`${num} text-dim`}>{formatMiB(row.vmLowP50MiB)}</td>
              <td className={`${num} text-dim`}>{formatMiB(row.vmSwapP90MiB)}</td>
              <td className={num}>{formatDuration(row.totalMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {selected && steps.data ? (
        <>
          <Heading>Steps of {jobName(selected)}, median of passing runs</Heading>
          <table className="border-collapse">
            <thead className="text-left text-[11px] tracking-wide text-dim uppercase">
              <tr>
                <th className={th}>Step</th>
                {steps.data.runnerTypes.map((type) => <th key={type} className={`${th} text-right`}>{type}</th>)}
              </tr>
            </thead>
            <tbody>
              {steps.data.steps.map((step) => {
                const values = Object.values(step.p50MsByRunnerType).filter((value) => value !== null);
                const slowest = values.length > 1 ? Math.max(...values) : null;
                return (
                  <tr key={step.name}>
                    <td className="py-0.5 pr-6">{step.name}</td>
                    {steps.data.runnerTypes.map((type) => {
                      const value = step.p50MsByRunnerType[type] ?? null;
                      return <td key={type} className={`${num} pl-6 ${value !== null && value === slowest ? "text-amber" : ""}`}>{formatDuration(value)}</td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      ) : null}
      <Heading>Machine headroom</Heading>
      {installs.size === 0 ? <p className="text-dim">No machine samples. They come from `runnerbox up` on this host.</p> : null}
      {[...installs].map(([install, own]) => (
        <div key={install} className="mb-3">
          <div className="pb-1">{install}</div>
          <HeadroomChart samples={own} days={days} />
        </div>
      ))}
      {summary.data && summary.data.launcher.length > 0 ? (
        <>
          <Heading>Launcher</Heading>
          <table className="border-collapse">
            <thead className="text-left text-[11px] tracking-wide text-dim uppercase">
              <tr>
                <th className={th}>Install</th><th className={th}>Kind</th><th className={`${th} text-right`}>Runners</th><th className={`${th} text-right`}>Failed</th>
                <th className={`${th} text-right`}>Released, memory</th><th className={`${th} text-right`}>Released, image</th><th className={`${th} text-right`}>Memory waits</th>
                <th className={`${th} text-right`}>Wait P90</th><th className={`${th} text-right`}>Builds</th><th className={`${th} text-right`}>Failed builds</th>
              </tr>
            </thead>
            <tbody>
              {summary.data.launcher.map((row) => (
                <tr key={`${row.install}${row.runnerType}`}>
                  <td className="py-0.5 pr-3">{row.install}</td><td className="py-0.5 pr-3">{row.runnerType}</td>
                  <td className={num}>{row.runners}</td><td className={`${num} ${row.failedRunners > 0 ? "text-red" : "text-dim"}`}>{row.failedRunners}</td>
                  <td className={`${num} text-dim`}>{row.releasedForMemory}</td><td className={`${num} text-dim`}>{row.releasedForImage}</td>
                  <td className={`${num} ${row.memoryWaits > 0 ? "text-amber" : "text-dim"}`}>{row.memoryWaits}</td><td className={`${num} text-dim`}>{formatDuration(row.memoryWaitP90Ms)}</td>
                  <td className={`${num} text-dim`}>{row.imageBuilds}</td><td className={`${num} ${row.failedBuilds > 0 ? "text-red" : "text-dim"}`}>{row.failedBuilds}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </div>
  );
}
