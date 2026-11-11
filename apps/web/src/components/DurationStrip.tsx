import type { JobRun } from "@runnerbox/contracts";
import { formatDuration, jobName } from "../lib/format.ts";

const HEIGHT = 70;
const color = (run: JobRun) =>
  run.runner === null ? "var(--color-faint)" : run.conclusion === "failure" || run.conclusion === "timed_out" ? "var(--color-red)" : "var(--color-blue)";

// Each job as a dot: across by when it started, up by how long it took.
export function DurationStrip({ runs, days, selectedId, onSelect }: { runs: readonly JobRun[]; days: number; selectedId: number | null; onSelect: (id: number) => void }) {
  const now = Date.now();
  const start = now - days * 24 * 60 * 60_000;
  const timed = runs.filter((run) => run.durationMs !== null && run.startedAt !== null);
  const longest = Math.max(1, ...timed.map((run) => run.durationMs!));
  return (
    <div className="px-3">
      <svg viewBox={`0 0 1000 ${HEIGHT}`} preserveAspectRatio="none" className="block h-[70px] w-full">
        {timed.map((run) => {
          const x = ((Date.parse(run.startedAt!) - start) / (now - start)) * 1000;
          const y = HEIGHT - 4 - (run.durationMs! / longest) * (HEIGHT - 8);
          return (
            <rect key={run.jobId} x={x - 2} y={y - 2} width={run.jobId === selectedId ? 6 : 4} height={run.jobId === selectedId ? 6 : 4} fill={color(run)} onClick={() => onSelect(run.jobId)}>
              <title>{`${jobName(run)} ${formatDuration(run.durationMs)}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="flex justify-between text-dim">
        <span>{days}d ago</span>
        <span>duration by start time, longest {formatDuration(longest)}</span>
        <span>now</span>
      </div>
    </div>
  );
}
