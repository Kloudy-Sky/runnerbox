import type { LauncherEvent } from "@runnerbox/contracts";
import { Heading } from "../components/Heading.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { InstallState } from "../components/InstallState.tsx";
import { useRunnerState } from "../hooks/useRunnerState.ts";
import { useRange } from "../hooks/useRange.ts";
import { useRpcQuery } from "../hooks/useRpcQuery.ts";
import { formatAge, formatDuration } from "../lib/format.ts";

export function RunnersPage() {
  const { days } = useRange();
  const events = useRpcQuery(["events", days], (client) => client["runners.events"]({ days }));
  const installs = useRunnerState();
  const recent = (events.data ?? []).toReversed().slice(0, 200);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-6">
      <PageHeader.Root>
        <PageHeader.Title>Runners</PageHeader.Title>
      </PageHeader.Root>
      <div className="px-6 text-[13px]">
      <Heading>Now</Heading>
      {installs?.length === 0 ? <p className="text-muted-foreground">No install reports live state. It comes from runnerbox up on that machine while it runs.</p> : null}
      {installs?.map((install) => <InstallState key={install.install} install={install} />)}
      <Heading>What up did, newest first</Heading>
      {events.isSuccess && recent.length === 0 ? <p className="text-muted-foreground">No launcher events. They come from runnerbox up on that machine.</p> : null}
      <table className="border-collapse">
        <tbody>
          {recent.map((event) => (
            <tr key={`${event.install}${event.startedAt}${event.event}${"slot" in event ? event.slot : ""}`}>
              <td className="py-0.5 pr-4 text-muted-foreground">{formatAge(event.startedAt)}</td>
              <td className="py-0.5 pr-4">{event.install}</td>
              <td className="py-0.5 pr-4">{event.runnerType ?? "-"}</td>
              <td className="py-0.5 pr-4">{event.event === "image_build" ? "image build" : event.event === "memory_wait" ? "memory wait" : "runner"}</td>
              <td className="py-0.5 pr-4 text-muted-foreground">{"slot" in event ? `slot ${event.slot}` : event.tag}</td>
              <td className={`py-0.5 pr-4 ${outcomeColor(event)}`}>{outcome(event)}</td>
              <td className="py-0.5 pr-4 text-right text-muted-foreground tabular-nums">{formatDuration(event.durationMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

const outcome = (event: LauncherEvent) =>
  event.event === "runner"
    ? event.released
      ? `released for ${event.released}`
      : event.exitCode === null
        ? "lost SSH"
        : `exit ${event.exitCode}`
    : event.event === "image_build"
      ? event.ok ? "built" : "failed"
      : "waited";

const outcomeColor = (event: LauncherEvent) =>
  (event.event === "runner" && !event.released && event.exitCode !== 0) || (event.event === "image_build" && !event.ok) ? "text-destructive" : "text-muted-foreground";
