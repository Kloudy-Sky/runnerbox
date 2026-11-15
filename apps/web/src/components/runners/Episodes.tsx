import type { Episode } from "@runnerbox/contracts";
import { ChevronRight } from "lucide-react";
import { formatAge, formatDuration } from "../../lib/format.ts";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible.tsx";

const SHOWN_ROWS = 10;

// What happened, newest first: one sentence for each stretch of related records, opening to the
// records themselves, where runner IDs and exit codes live.
export function Episodes({ episodes, now }: { episodes: ReadonlyArray<Episode>; now: number }) {
  if (episodes.length === 0) return <p className="text-muted-foreground">Nothing recorded in this range.</p>;
  return (
    <div className="flex flex-col gap-1.5">
      {episodes.map((episode) => {
        const more = episode.rows.length - SHOWN_ROWS + episode.more;
        return (
          <Collapsible key={episode.id}>
            <CollapsibleTrigger className="group/episode grid w-full grid-cols-[1rem_4.25rem_minmax(0,1fr)] items-start text-left">
              <ChevronRight className="mt-0.5 size-3.5 text-muted-foreground transition-transform duration-150 group-data-panel-open/episode:rotate-90" />
              <span className="whitespace-nowrap text-muted-foreground tabular-nums">{formatAge(episode.endedAt, now)} ago</span>
              <span className={episode.bad ? "text-destructive" : undefined}>{episode.sentence}</span>
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <div className="overflow-x-auto pt-1 pb-2 pl-[5.25rem]">
                <table className="border-collapse text-[12px] text-muted-foreground">
                  <tbody>
                    {episode.rows.slice(0, SHOWN_ROWS).map((row) => (
                      <tr key={`${row.at}-${row.kind}-${row.slot}-${row.what}`}>
                        <td className="py-0.5 pr-3 whitespace-nowrap tabular-nums">{formatAge(row.at, now)}</td>
                        <td className="py-0.5 pr-3 whitespace-nowrap">{[row.kind, row.slot].filter((part) => part !== null).join(" ")}</td>
                        <td className="py-0.5 pr-3">{row.what}</td>
                        <td className="py-0.5 pr-3 font-mono text-[11px]">{row.runner}</td>
                        <td className="py-0.5 pr-3 whitespace-nowrap">{row.exitCode === null ? "" : `exit ${row.exitCode}`}</td>
                        <td className="py-0.5 text-right tabular-nums">{formatDuration(row.durationMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {more > 0 ? <p className="pt-1 text-muted-foreground">and {more} more</p> : null}
              </div>
            </CollapsiblePanel>
          </Collapsible>
        );
      })}
    </div>
  );
}
