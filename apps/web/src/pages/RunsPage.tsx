import type { JobRun } from "@runnerbox/contracts";
import { useState } from "react";
import { NoHistory } from "../components/NoHistory.tsx";
import { DurationStrip } from "../components/DurationStrip.tsx";
import { RepoPicker } from "../components/RepoPicker.tsx";
import { ThreadDock } from "../components/ThreadDock.tsx";
import { useRange } from "../hooks/useRange.ts";
import { useRepo } from "../hooks/useRepo.ts";
import { useRpcQuery } from "../hooks/useRpcQuery.ts";
import { formatAge, formatDuration, jobName } from "../lib/format.ts";
import { VERDICT_WORDS } from "../lib/vocabulary.ts";

const VERDICT_COLOR = { code: "text-red", infra: "text-amber", flaky: "text-amber", unconfirmed: "text-dim" } as const;

function Status({ run }: { run: JobRun }) {
  if (run.runner === null && run.conclusion !== "skipped") return <span className="text-dim">○</span>;
  if (run.conclusion === "success") return <span className="text-green">✓</span>;
  if (run.conclusion === "failure" || run.conclusion === "timed_out") return <span className="text-red">✕</span>;
  return <span className="text-dim">–</span>;
}

export function RunsPage() {
  const { days } = useRange();
  const { repo, loaded } = useRepo();
  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const runs = useRpcQuery(["runs", repo, days], (client) => client["history.runs"]({ repo: repo!, days, limit: 2000 }));
  if (loaded && !repo) return <NoHistory />;
  const needle = filter.trim().toLowerCase();
  const rows = (runs.data ?? []).filter((run) => !needle || `${jobName(run)} ${run.branch ?? ""} ${run.runnerType}`.toLowerCase().includes(needle));
  const selected = rows.find((run) => run.jobId === selectedId);
  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-auto py-2">
        <div className="flex items-baseline gap-4 px-3 pb-2">
          <RepoPicker />
          <span className="flex-1" />
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter jobs, branches, runners" className="w-60 bg-surf px-2 py-0.5 text-fg outline-none placeholder:text-faint" />
        </div>
        <DurationStrip runs={rows} days={days} selectedId={selectedId} onSelect={setSelectedId} />
        <table className="mt-2 w-full border-collapse">
          <thead className="text-left text-[11px] tracking-wide text-dim uppercase">
            <tr>
              <th className="w-6 py-1 pl-3 font-medium" />
              <th className="py-1 pr-3 font-medium">Job</th>
              <th className="py-1 pr-3 font-medium">Branch</th>
              <th className="py-1 pr-3 font-medium">Runner</th>
              <th className="py-1 pr-3 font-medium">Commit</th>
              <th className="py-1 pr-3 font-medium">Run</th>
              <th className="py-1 pr-3 font-medium">Age</th>
              <th className="py-1 pr-3 text-right font-medium">Waited</th>
              <th className="py-1 pr-3 text-right font-medium">Time</th>
              <th className="py-1 pr-3 font-medium">Cause</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((run) => (
              <tr key={run.jobId} onClick={() => setSelectedId(run.jobId)} className={run.jobId === selectedId ? "bg-surf2" : "hover:bg-surf"}>
                <td className="py-0.5 pl-3"><Status run={run} /></td>
                <td className="py-0.5 pr-3 whitespace-nowrap">{jobName(run)}</td>
                <td className="py-0.5 pr-3 whitespace-nowrap text-dim">{run.branch}</td>
                <td className="py-0.5 pr-3 whitespace-nowrap">{run.runnerType}</td>
                <td className="py-0.5 pr-3 font-mono text-[11.5px] text-dim">{run.headSha?.slice(0, 7) ?? "-"}</td>
                <td className="py-0.5 pr-3 font-mono text-[11.5px] whitespace-nowrap text-dim">#{run.runId}{run.attempt > 1 ? ` attempt ${run.attempt}` : ""}</td>
                <td className="py-0.5 pr-3 text-dim">{formatAge(run.createdAt)}</td>
                <td className="py-0.5 pr-3 text-right text-dim tabular-nums">{formatDuration(run.queueMs)}</td>
                <td className="py-0.5 pr-3 text-right tabular-nums">{run.runner === null ? "-" : formatDuration(run.durationMs)}</td>
                <td className="py-0.5 pr-3">{run.verdict ? <span className={VERDICT_COLOR[run.verdict]}>{VERDICT_WORDS[run.verdict]}</span> : run.starved ? <span className="text-dim">no runner came</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selected ? (
        <ThreadDock
          key={selected.jobId}
          subject={{ _tag: "run", repo: selected.repo, jobId: selected.jobId }}
          days={days}
          title={`${jobName(selected)} #${selected.runId}${selected.attempt > 1 ? ` attempt ${selected.attempt}` : ""}`}
          detail={[selected.verdict ? `failed: ${VERDICT_WORDS[selected.verdict]}` : selected.conclusion, selected.runnerType, selected.branch].filter(Boolean).join(", ")}
        />
      ) : null}
    </div>
  );
}
