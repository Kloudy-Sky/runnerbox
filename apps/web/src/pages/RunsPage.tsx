import type { JobRun } from "@runnerbox/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { DurationStrip } from "../components/DurationStrip.tsx";
import { NoHistory } from "../components/NoHistory.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { RepoPicker } from "../components/RepoPicker.tsx";
import { Input } from "../components/ui/input.tsx";
import { useRange } from "../hooks/useRange.ts";
import { useRepo } from "../hooks/useRepo.ts";
import { useRpcQuery } from "../hooks/useRpcQuery.ts";
import { formatAge, formatDuration, jobName } from "../lib/format.ts";
import type { RootSearch } from "../lib/search.ts";
import { VERDICT_WORDS } from "../lib/vocabulary.ts";

const VERDICT_COLOR = { code: "text-destructive", infra: "text-warning", flaky: "text-warning", unconfirmed: "text-muted-foreground" } as const;

function Status({ run }: { run: JobRun }) {
  if (run.runner === null && run.conclusion !== "skipped") return <span className="text-muted-foreground">○</span>;
  if (run.conclusion === "success") return <span className="text-success">✓</span>;
  if (run.conclusion === "failure" || run.conclusion === "timed_out") return <span className="text-destructive">✕</span>;
  return <span className="text-muted-foreground">–</span>;
}

const th = "py-1.5 pr-4 text-left font-normal text-muted-foreground";

export function RunsPage() {
  const { days } = useRange();
  const { repo, loaded } = useRepo();
  const [filter, setFilter] = useState("");
  const navigate = useNavigate();
  const runs = useRpcQuery(["runs", repo, days], (client) => client["history.runs"]({ repo: repo!, days, limit: 2000 }));
  if (loaded && !repo) return <NoHistory />;
  const needle = filter.trim().toLowerCase();
  const rows = (runs.data ?? []).filter((run) => !needle || `${jobName(run)} ${run.branch ?? ""} ${run.runnerType}`.toLowerCase().includes(needle));
  const open = (jobId: number) => void navigate({ to: "/runs/$jobId", params: { jobId: String(jobId) }, search: (previous: RootSearch) => previous });
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-6">
      <PageHeader.Root>
        <PageHeader.Title>All runs</PageHeader.Title>
        <RepoPicker />
        <PageHeader.Spacer />
        <Input value={filter} onValueChange={setFilter} placeholder="Filter by job, branch or runner" className="w-64" size="sm" />
      </PageHeader.Root>
      <div className="px-3">
        <DurationStrip runs={rows} days={days} selectedId={null} onSelect={open} />
      </div>
      <table className="mt-3 w-full border-collapse text-[13px]">
        <thead>
          <tr>
            <th className={`${th} w-8 pl-6`} />
            <th className={th}>Job</th>
            <th className={th}>Branch</th>
            <th className={th}>Runner</th>
            <th className={th}>Commit</th>
            <th className={th}>Run</th>
            <th className={th}>Started</th>
            <th className={`${th} text-right`}>Waited</th>
            <th className={`${th} text-right`}>Took</th>
            <th className={`${th} pr-6`}>Cause</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((run) => (
            <tr key={run.jobId} onClick={() => open(run.jobId)} className="cursor-default hover:bg-surface">
              <td className="py-1 pl-6"><Status run={run} /></td>
              <td className="py-1 pr-4 whitespace-nowrap">{jobName(run)}</td>
              <td className="py-1 pr-4 whitespace-nowrap text-muted-foreground">{run.branch}</td>
              <td className="py-1 pr-4 whitespace-nowrap">{run.runnerType}</td>
              <td className="py-1 pr-4 font-mono text-[12px] text-muted-foreground">{run.headSha?.slice(0, 7) ?? "-"}</td>
              <td className="py-1 pr-4 font-mono text-[12px] whitespace-nowrap text-muted-foreground">#{run.runId}{run.attempt > 1 ? ` attempt ${run.attempt}` : ""}</td>
              <td className="py-1 pr-4 whitespace-nowrap text-muted-foreground">{formatAge(run.createdAt)} ago</td>
              <td className="py-1 pr-4 text-right text-muted-foreground tabular-nums">{formatDuration(run.queueMs)}</td>
              <td className="py-1 pr-4 text-right tabular-nums">{run.runner === null ? "-" : formatDuration(run.durationMs)}</td>
              <td className="py-1 pr-6 whitespace-nowrap">{run.verdict ? <span className={VERDICT_COLOR[run.verdict]}>{VERDICT_WORDS[run.verdict]}</span> : run.starved ? <span className="text-muted-foreground">no runner came</span> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
