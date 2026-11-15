import { formatDuration } from "../../lib/format.ts";
import { tickText } from "../../lib/tickText.ts";

// While the agent works: how long for, counting from the question, as T3 Code's working row. Only
// the text changes, once a second.
export function WorkingRow({ since }: { since: string }) {
  const start = Date.parse(since);
  return (
    <div className="border-b border-border/60 pt-1 pb-2">
      <div className="flex h-6 min-w-0 items-baseline gap-2 px-1 text-sm leading-relaxed text-muted-foreground tabular-nums">
        <span className="shrink-0 whitespace-nowrap">
          Working for <span ref={tickText((now) => formatDuration(Math.max(0, now - start)))} className="tabular-nums" />
        </span>
      </div>
    </div>
  );
}
