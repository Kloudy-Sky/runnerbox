import { FileTextIcon, PlayIcon } from "lucide-react";
import type { ReferenceCandidate } from "../../lib/composerReferences.ts";
import { cn } from "~/lib/utils";

// The `@` list above the composer: matching threads and runs, the highlighted one picked with Enter
// or Tab. The editor keeps the keyboard, so nothing here takes focus.
export function ReferenceMenu({ items, active, onPick }: { items: ReadonlyArray<ReferenceCandidate>; active: number; onPick: (item: ReferenceCandidate) => void }) {
  return (
    <div className="absolute inset-x-0 bottom-full z-20 mb-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-sm shadow-lg" role="listbox" aria-label="Refer to a thread or run">
      {items.length === 0 ? (
        <p className="px-2 py-1.5 text-muted-foreground">No thread or run matches.</p>
      ) : (
        items.map((item, index) => (
          <button
            key={item.kind === "thread" ? item.id : `${item.repo}#${item.jobId}`}
            type="button"
            role="option"
            aria-selected={index === active}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(item)}
            className={cn("flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left", index === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60")}
          >
            {item.kind === "thread" ? <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" /> : <PlayIcon className="size-3.5 shrink-0 text-muted-foreground" />}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            <span className="shrink-0 text-muted-foreground text-xs">{item.detail}</span>
          </button>
        ))
      )}
    </div>
  );
}
