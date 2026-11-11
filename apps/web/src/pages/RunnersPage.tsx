import type { LauncherEvent } from "@runnerbox/contracts";
import { Heading } from "../components/Heading.tsx";
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
    <div className="px-3 py-2">
      <Heading>Now</Heading>
      {installs?.length === 0 ? <p className="text-dim">No install reports live state. It comes from runnerbox up on that machine while it runs.</p> : null}
      {installs?.map((install) => <InstallState key={install.install} install={install} />)}
      <Heading>What up did, newest first</Heading>
      {events.isSuccess && recent.length === 0 ? <p className="text-dim">No launcher events. They come from runnerbox up on that machine.</p> : null}
      <table className="border-collapse">
        <tbody>
          {recent.map((event) => (
            <tr key={`${event.install}${event.startedAt}${event.event}${"slot" in event ? event.slot : ""}`}>
              <td className="py-0.5 pr-4 text-dim">{formatAge(event.startedAt)}</td>
              <td className="py-0.5 pr-4">{event.install}</td>
              <td className="py-0.5 pr-4">{event.runnerType ?? "-"}</td>
              <td className="py-0.5 pr-4">{event.event === "image_build" ? "image build" : event.event === "memory_wait" ? "memory wait" : "runner"}</td>
              <td className="py-0.5 pr-4 text-dim">{"slot" in event ? `slot ${event.slot}` : event.tag}</td>
              <td className={`py-0.5 pr-4 ${outcomeColor(event)}`}>{outcome(event)}</td>
              <td className="py-0.5 pr-4 text-right text-dim tabular-nums">{formatDuration(event.durationMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
  (event.event === "runner" && !event.released && event.exitCode !== 0) || (event.event === "image_build" && !event.ok) ? "text-red" : "text-dim";
