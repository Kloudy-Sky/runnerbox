import type { KindUsage } from "@runnerbox/contracts";
import { formatDuration } from "../../lib/format.ts";

const th = "py-1.5 pr-4 font-normal text-muted-foreground";

// One row per kind of runner: how many runners it has, how much of the window all of them were
// busy at once, and how long jobs waited for one. Under it, the bottleneck in the inbox's own
// words when the evidence names one, and nothing when it doesn't.
export function KindWaits({ kinds }: { readonly kinds: readonly KindUsage[] }) {
  if (kinds.length === 0) return <p className="text-muted-foreground">No runners of yours ran jobs in this time.</p>;
  const sentences = kinds.flatMap((kind) => (kind.bottleneck ? [kind.bottleneck.text] : []));
  // Two machines can each have a kind of the same name, so the rows name the machine when there's more than one.
  const machines = new Set(kinds.map((kind) => kind.install)).size;
  return (
    <div className="flex flex-col gap-2">
      <table className="w-full max-w-3xl border-collapse">
        <thead className="text-left">
          <tr>
            <th className={th}>Kind</th>
            <th className={`${th} text-right`}>Runners</th>
            <th className={`${th} w-1/3`}>All busy at once</th>
            <th className={`${th} text-right`}>Typical wait</th>
            <th className={`${th} text-right`}>Longest wait</th>
          </tr>
        </thead>
        <tbody>
          {kinds.map((kind) => (
            <tr key={`${kind.install}\0${kind.kind}`}>
              <td className="py-1 pr-4 whitespace-nowrap">{machines > 1 ? `${kind.install} / ${kind.kind}` : kind.kind}</td>
              <td className="py-1 pr-4 text-right tabular-nums">{kind.slots ?? "-"}</td>
              <td className="py-1 pr-4">
                {kind.allBusyShare === null ? (
                  <span className="text-muted-foreground">-</span>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 rounded-xs bg-muted">
                      <div className="h-full rounded-xs bg-info" style={{ width: `${kind.allBusyShare * 100}%` }} />
                    </div>
                    <span className="w-9 shrink-0 text-right tabular-nums text-muted-foreground">{Math.round(kind.allBusyShare * 100)}%</span>
                  </div>
                )}
              </td>
              <td className="py-1 pr-4 text-right tabular-nums">{formatDuration(kind.waitTypicalMs)}</td>
              <td className="py-1 pr-4 text-right tabular-nums">{formatDuration(kind.waitLongestMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sentences.map((sentence) => (
        <p key={sentence} className="text-foreground/90">
          {sentence}
        </p>
      ))}
    </div>
  );
}
