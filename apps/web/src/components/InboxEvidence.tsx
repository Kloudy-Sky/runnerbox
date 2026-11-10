import type { InboxItem } from "@runnerbox/contracts";
import { formatAge, formatDuration, formatMiB } from "../lib/format.ts";
import { Heading } from "./Heading.tsx";
import { Sparkline } from "./Sparkline.tsx";

const conclusionMark = (conclusion: string | null) =>
  conclusion === "success" ? <span className="text-green">✓</span> : conclusion === "failure" || conclusion === "timed_out" ? <span className="text-red">✕</span> : <span className="text-dim">○</span>;

// Everything the item was decided from, so its verdict can be checked rather than trusted.
export function InboxEvidence({ item }: { item: InboxItem }) {
  const { steps, attempts, machine, launcher, durations, reasons } = item.evidence;
  return (
    <aside className="w-[380px] shrink-0 overflow-auto bg-surf px-3 py-2">
      <div className="font-medium">{item.title}</div>
      <div className="text-dim">{[item.repo, item.install].filter(Boolean).join(" ")}</div>
      <ul className="mt-2">
        {reasons.map((reason) => (
          <li key={reason}>{reason.charAt(0).toUpperCase() + reason.slice(1)}.</li>
        ))}
      </ul>
      {steps.length > 0 ? (
        <>
          <Heading>Steps, this attempt</Heading>
          <table className="w-full">
            <tbody>
              {steps.map((step) => (
                <tr key={step.name} className={step.conclusion === "failure" ? "text-red" : step.conclusion === "skipped" ? "text-dim" : ""}>
                  <td className="pr-3">{step.name}</td>
                  <td className="pr-3 text-right tabular-nums">{formatDuration(step.ms)}</td>
                  <td className="text-right text-dim tabular-nums">{step.typicalMs === null ? "" : `usually ${formatDuration(step.typicalMs)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      {attempts.length > 0 ? (
        <>
          <Heading>{item.kind === "no_runner" ? "Jobs" : "Attempts in this run"}</Heading>
          {attempts.map((attempt) => (
            <div key={attempt.jobId} className="flex gap-2">
              {conclusionMark(attempt.conclusion)}
              <span>{item.kind === "no_runner" ? attempt.conclusion : `attempt ${attempt.attempt}`}</span>
              <span className="text-dim">{attempt.runnerType}</span>
              <span className="flex-1" />
              <span className="text-dim tabular-nums">{formatDuration(attempt.durationMs)}</span>
              <span className="w-8 text-right text-dim">{formatAge(attempt.startedAt)}</span>
            </div>
          ))}
        </>
      ) : null}
      {machine ? (
        <>
          <Heading>Machine during the job, {machine.samples} samples</Heading>
          <table>
            <tbody>
              <tr><td className="pr-4 text-dim">VM lowest available</td><td>{formatMiB(machine.vmLowMiB)}{machine.vmTotalMiB ? <span className="text-dim"> of {formatMiB(machine.vmTotalMiB)}</span> : null}</td></tr>
              <tr><td className="pr-4 text-dim">VM swap peak</td><td>{formatMiB(machine.vmSwapPeakMiB)}</td></tr>
              <tr><td className="pr-4 text-dim">Host lowest available</td><td>{formatMiB(machine.hostLowMiB)}</td></tr>
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
            <div key={`${event.startedAt}${event.event}`} className="flex gap-2 font-mono text-[11.5px] text-dim">
              <span>{event.event === "runner" ? `runner exit ${event.exitCode ?? "lost SSH"}${event.released ? `, released for ${event.released}` : ""}` : event.event === "memory_wait" ? `memory wait, slot ${event.slot}` : `image build ${event.ok ? "ok" : "failed"}`}</span>
              <span className="flex-1" />
              <span>{formatDuration(event.durationMs)}</span>
              <span className="w-8 text-right">{formatAge(event.startedAt)}</span>
            </div>
          ))}
        </>
      ) : null}
    </aside>
  );
}
