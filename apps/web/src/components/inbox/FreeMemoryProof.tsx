import type { InboxItem, MachineSample } from "@runnerbox/contracts";
import { useRpcQuery } from "../../hooks/useRpcQuery.ts";
import { formatMiB } from "../../lib/format.ts";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const HEIGHT = 80;
// Room around the runs, and the least the chart spans, so a short failure still reads as a dip.
const MARGIN = 5 * MINUTE;
const LEAST = 30 * MINUTE;

const failed = (conclusion: string | null) => conclusion === "failure" || conclusion === "timed_out" || conclusion === "cancelled";
const lowest = (samples: ReadonlyArray<MachineSample & { vm: NonNullable<MachineSample["vm"]> }>) => Math.min(...samples.map((sample) => sample.vm.availableMiB));

// The VM's free memory while the item's runs ran, with each failed run marked, on the machine that
// reported the item (read under its EnvironmentScope). Samples are a minute apart, so it's asked
// unthinned. Draws nothing when the machine kept no samples for that stretch.
export function FreeMemoryProof({ item }: { item: InboxItem }) {
  const runs = item.evidence.attempts.flatMap((attempt) => (attempt.startedAt ? [{ start: Date.parse(attempt.startedAt), end: Date.parse(attempt.startedAt) + (attempt.durationMs ?? 0), failed: failed(attempt.conclusion) }] : []));
  const end = Math.max(Date.parse(item.at), ...runs.map((run) => run.end)) + MARGIN;
  const start = Math.min(end - LEAST, ...runs.map((run) => run.start - MARGIN));
  const days = Math.min(90, Math.max(1, Math.ceil((Date.now() - start) / DAY)));
  const answer = useRpcQuery(["runners.samples", days, "unthinned"], (client) => client["runners.samples"]({ days, maxPoints: Math.min(5000, days * 1440) }));
  const inWindow = (answer.data ?? []).flatMap((sample) => {
    const time = Date.parse(sample.time);
    return sample.vm && time >= start && time <= end ? [{ ...sample, vm: sample.vm }] : [];
  });
  // The install the item names, or the one that ran lowest, when it names none.
  const byInstall = Map.groupBy(inWindow, (sample) => sample.install);
  const named = item.install ?? item.evidence.launcher[0]?.install;
  const install = named !== undefined && byInstall.has(named) ? named : [...byInstall].toSorted(([, a], [, b]) => lowest(a) - lowest(b))[0]?.[0];
  const samples = install === undefined ? [] : (byInstall.get(install) ?? []);
  if (samples.length < 2) return null;
  const total = Math.max(...samples.map((sample) => sample.vm.totalMiB));
  const x = (time: number) => ((time - start) / (end - start)) * 1000;
  const y = (mib: number) => HEIGHT - (mib / total) * HEIGHT;
  const line = samples.map((sample) => `${x(Date.parse(sample.time))},${y(sample.vm.availableMiB)}`).join(" ");
  const minutes = Math.round((end - start) / MINUTE);
  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="text-muted-foreground text-xs">
        Free memory on {install}, {minutes} minutes around the runs
      </figcaption>
      <svg viewBox={`0 0 1000 ${HEIGHT}`} preserveAspectRatio="none" className="block h-20 w-full max-w-md" role="img" aria-label={`Free memory fell to ${formatMiB(lowest(samples))} of ${formatMiB(total)}`}>
        {runs.filter((run) => run.failed).map((run) => (
          <line key={run.start} x1={x(run.start)} x2={x(run.start)} y1={0} y2={HEIGHT} stroke="var(--color-destructive)" strokeWidth="1" vectorEffect="non-scaling-stroke" opacity="0.6" />
        ))}
        <polyline points={line} fill="none" stroke="var(--color-foreground)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="text-muted-foreground text-xs">
        Lowest {formatMiB(lowest(samples))} of {formatMiB(total)}. <span className="text-destructive">Red</span> marks a run that failed.
      </div>
    </figure>
  );
}
