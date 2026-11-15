import type { JobResources, PlacedStep } from "@runnerbox/contracts";
import { formatDuration, formatMiB } from "../../lib/format.ts";
import { ResourceChart } from "./ResourceChart.tsx";
import { StepBar } from "./StepBar.tsx";

// Headroom above the higher of the limit and the peak, so a line at the limit isn't drawn on the
// plot's top edge.
const HEADROOM = 1.08;

const cpus = (percent: number) => {
  const count = Math.round(percent / 10) / 10;
  return `${count} ${count === 1 ? "CPU" : "CPUs"}`;
};

// One job's steps, its container's memory and CPU as two graphs with one axis each, and the
// server's sentence about them, unless the page shows that sentence as its Why instead. Used on a
// run's page and in Speed and cost's job panel.
// `markedStep` stands out in the step bar instead of the one the sentence names, as Speed and cost
// marks the step that grew.
export function JobResourcesView({ resources, sentenceShown = true, markedStep }: { readonly resources: JobResources; readonly sentenceShown?: boolean; readonly markedStep?: string | null }) {
  const { steps, points, limits, sentence } = resources;
  const durationMs = resources.job.durationMs ?? points.at(-1)?.offsetMs ?? 0;
  const marked = steps.find((step): step is PlacedStep & { offsetMs: number; ms: number } => step.name === sentence?.step && step.exact && step.offsetMs !== null && step.ms !== null);
  const mark = marked ? { fromMs: marked.offsetMs, toMs: marked.offsetMs + marked.ms, label: `${marked.name} starts` } : null;
  const stepAt = (offsetMs: number) =>
    steps.find((step) => step.exact && step.offsetMs !== null && step.ms !== null && offsetMs >= step.offsetMs && offsetMs <= step.offsetMs + step.ms)?.name ?? null;
  const describe = (offsetMs: number) => `${formatDuration(offsetMs)} in${stepAt(offsetMs) ? `, ${stepAt(offsetMs)}` : ""}`;
  const drawn = resources.coverage === "sampled" && points.length >= 2;

  const memoryPeak = Math.max(...points.map((point) => point.memMiB), 0);
  const memoryTop = limits ? limits.memoryMiB : memoryPeak;
  const cpuPeak = Math.max(...points.map((point) => point.cpuPercent), 0);
  const cpuTop = limits ? limits.cpus * 100 : Math.max(100, Math.ceil(cpuPeak / 100) * 100);
  return (
    // Two graphs side by side only when its own column is wide enough: the run page is, Speed and
    // cost's panel isn't.
    <div className="@container flex flex-col gap-4">
      <StepBar steps={steps} marked={markedStep === undefined ? (sentence?.step ?? null) : markedStep} />
      {drawn ? (
        <div className="grid gap-5 @xl:grid-cols-2">
          <section className="flex flex-col gap-1.5">
            <h3 className="font-medium">
              Memory this job used {limits ? <span className="font-normal text-muted-foreground">limit {formatMiB(limits.memoryMiB)}</span> : null}
            </h3>
            <ResourceChart
              label="Memory the job's container used over its run"
              points={points.map((point) => ({ offsetMs: point.offsetMs, value: point.memMiB }))}
              durationMs={durationMs}
              max={Math.max(memoryTop, memoryPeak) * HEADROOM}
              ticks={[0, memoryTop / 2, memoryTop]}
              limit={limits ? { value: limits.memoryMiB, label: `limit ${formatMiB(limits.memoryMiB)}` } : null}
              mark={mark}
              format={formatMiB}
              describe={describe}
            />
          </section>
          <section className="flex flex-col gap-1.5">
            <h3 className="font-medium">
              CPU this job used {limits ? <span className="font-normal text-muted-foreground">limit {cpus(limits.cpus * 100)}</span> : null}
            </h3>
            <ResourceChart
              label="CPU the job's container used over its run"
              points={points.map((point) => ({ offsetMs: point.offsetMs, value: point.cpuPercent }))}
              durationMs={durationMs}
              max={Math.max(cpuTop, cpuPeak) * HEADROOM}
              ticks={[0, cpuTop / 2, cpuTop]}
              limit={limits ? { value: limits.cpus * 100, label: `limit ${cpus(limits.cpus * 100)}` } : null}
              mark={mark}
              format={cpus}
              describe={describe}
            />
          </section>
        </div>
      ) : null}
      {sentence && sentenceShown ? <p className="text-foreground/90">{sentence.text}</p> : null}
    </div>
  );
}
