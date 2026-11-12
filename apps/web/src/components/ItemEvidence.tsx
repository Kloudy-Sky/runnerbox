import type { InboxItem } from "@runnerbox/contracts";
import { formatAge, formatDuration, formatMiB } from "../lib/format.ts";
import { Heading } from "./Heading.tsx";
import { Sparkline } from "./Sparkline.tsx";

const conclusionMark = (conclusion: string | null) =>
  conclusion === "success" ? <span className="text-success">✓</span> : conclusion === "failure" || conclusion === "timed_out" ? <span className="text-destructive">✕</span> : <span className="text-muted-foreground">○</span>;

// Everything an item was decided from, so it can be checked rather than trusted. It sits collapsed
// under the item's three sections.
export function ItemEvidence({ item }: { item: InboxItem }) {
  const { steps, attempts, machine, launcher, durations, breakdown } = item.evidence;
  return (
    <div className="flex flex-col text-[13px]" data-slot="evidence">
      {breakdown.length > 0 ? (
        <>
          <Heading>Where</Heading>
          <table className="w-full">
            <tbody>
              {breakdown.map((part) => (
                <tr key={part.label}>
                  <td className="pr-3">{part.label}</td>
                  <td className="pr-3 text-right tabular-nums">{part.count}</td>
                  <td className="text-muted-foreground">{part.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      {steps.length > 0 ? (
        <>
          <Heading>Steps, this attempt</Heading>
          <table className="w-full">
            <tbody>
              {steps.map((step) => (
                <tr key={step.name} className={step.conclusion === "failure" ? "text-destructive" : step.conclusion === "skipped" ? "text-muted-foreground" : ""}>
                  <td className="pr-3">{step.name}</td>
                  <td className="pr-3 text-right tabular-nums">{formatDuration(step.ms)}</td>
                  <td className="text-right text-muted-foreground tabular-nums">{step.typicalMs === null ? "" : `usually ${formatDuration(step.typicalMs)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      {attempts.length > 0 ? (
        <>
          <Heading>{item.kind === "no_runner" ? "Jobs that waited" : attempts.some((attempt) => attempt.headSha !== null) ? "Attempts on this commit" : "Attempts in this run"}</Heading>
          {attempts.map((attempt) => (
            <div key={attempt.jobId} className="flex gap-2">
              {conclusionMark(attempt.conclusion)}
              <span>{item.kind === "no_runner" ? attempt.conclusion : `#${attempt.runId}${attempt.attempt > 1 ? ` attempt ${attempt.attempt}` : ""}`}</span>
              <span className="text-muted-foreground">{attempt.runnerType}</span>
              <span className="flex-1" />
              <span className="text-muted-foreground tabular-nums">{formatDuration(attempt.durationMs)}</span>
              <span className="w-8 text-right text-muted-foreground">{formatAge(attempt.startedAt)}</span>
            </div>
          ))}
        </>
      ) : null}
      {machine ? (
        <>
          <Heading>Machine during the job, {machine.samples} samples</Heading>
          <table>
            <tbody>
              <tr><td className="pr-4 text-muted-foreground">VM lowest available</td><td>{formatMiB(machine.vmLowMiB)}{machine.vmTotalMiB ? <span className="text-muted-foreground"> of {formatMiB(machine.vmTotalMiB)}</span> : null}</td></tr>
              <tr><td className="pr-4 text-muted-foreground">VM swap peak</td><td>{formatMiB(machine.vmSwapPeakMiB)}</td></tr>
              <tr><td className="pr-4 text-muted-foreground">Host lowest available</td><td>{formatMiB(machine.hostLowMiB)}</td></tr>
            </tbody>
          </table>
        </>
      ) : null}
      {durations.length > 0 ? (
        <>
          <Heading>Duration, oldest to newest</Heading>
          <Sparkline values={durations.map((point) => point.ms)} />
        </>
      ) : null}
      {launcher.length > 0 ? (
        <>
          <Heading>Launcher</Heading>
          {launcher.map((event) => (
            <div key={`${event.startedAt}${event.event}`} className="flex gap-2 font-mono text-[11.5px] text-muted-foreground">
              <span>{event.event === "runner" ? `runner exit ${event.exitCode ?? "lost SSH"}${event.released ? `, released for ${event.released}` : ""}` : event.event === "memory_wait" ? `memory wait, slot ${event.slot}` : `image build ${event.ok ? "ok" : "failed"}`}</span>
              <span className="flex-1" />
              <span>{formatDuration(event.durationMs)}</span>
              <span className="w-8 text-right">{formatAge(event.startedAt)}</span>
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}
