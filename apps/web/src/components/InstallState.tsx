import type { InstallState as Install, SlotPhase } from "@runnerbox/contracts";
import { formatAge } from "../lib/format.ts";
import { ImageFacts } from "./ImageFacts.tsx";

// What a slot is doing, in words, and its colour.
export const PHASE: Record<SlotPhase, [string, string]> = {
  registered: ["listening", "text-success"],
  busy: ["on a job", "text-foreground"],
  minting: ["registering", "text-muted-foreground"],
  waiting: ["waiting for memory", "text-warning"],
  backoff: ["backing off", "text-destructive"],
  stopped: ["stopped", "text-muted-foreground"],
};

// One install as Runnerbox on the machine reports it now: each kind's image and each slot's phase. `typicalBuildMs`
// gives a kind's usual image build length from history, for a build in progress.
export function InstallState({ install, typicalBuildMs }: { install: Install; typicalBuildMs: (kind: string) => number | null }) {
  // Ages are measured from the machine's last report, which comes at least every 15 seconds, so they
  // move with the data and the render stays pure.
  const now = Date.parse(install.updatedAt);
  return (
    <div className="pb-4">
      <div className="flex items-baseline gap-3">
        <span className="font-medium">{install.install}</span>
        <span className="text-muted-foreground" title={`pid ${install.pid}`}>running since {formatAge(install.startedAt, now)} ago</span>
        {install.stopping ? <span className="text-warning">draining</span> : null}
        {install.stale ? <span className="text-destructive">not updated for {formatAge(install.updatedAt)}, so Runnerbox may have stopped</span> : null}
      </div>
      <table className={`mt-1 border-collapse ${install.stale ? "opacity-50" : ""}`}>
        <tbody>
          {install.kinds.flatMap((kind) => [
            <tr key={kind.name}>
              <td colSpan={5} className="pt-2 pb-0.5">
                <span>{kind.name}</span>
                <span className="ml-3 text-muted-foreground">{kind.label}</span>
                <span className="ml-3 font-mono text-[11.5px] text-muted-foreground">{kind.image ?? "no image yet"}</span>
                {kind.building && !kind.buildingSince ? <span className="ml-3 text-warning">building {kind.building}</span> : null}
              </td>
            </tr>,
            <tr key={`${kind.name}-image`}>
              <td colSpan={5} className="pl-3">
                <ImageFacts kind={kind} now={now} typicalBuildMs={typicalBuildMs(kind.name)} />
              </td>
            </tr>,
            ...kind.slots.map((slot) => {
              const [label, color] = PHASE[slot.phase];
              return (
                <tr key={`${kind.name}${slot.slot}`}>
                  <td className="py-0.5 pr-4 pl-3 text-muted-foreground">slot {slot.slot}</td>
                  <td className={`py-0.5 pr-4 whitespace-nowrap ${color}`}>{label}</td>
                  <td className="py-0.5 pr-4 text-muted-foreground">{formatAge(slot.since)}</td>
                  <td className="py-0.5 pr-4">{slot.job ?? <span className="font-mono text-[11.5px] text-muted-foreground">{slot.runner}</span>}</td>
                  <td className="py-0.5 text-muted-foreground">{slot.detail}</td>
                </tr>
              );
            }),
          ])}
        </tbody>
      </table>
    </div>
  );
}
