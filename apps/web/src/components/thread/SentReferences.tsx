import type { ResolvedReference } from "@runnerbox/contracts";
import { FileTextIcon, PlayIcon } from "lucide-react";

// The threads and runs a question referred to, under it, with the icons the `@` list uses.
export function SentReferences({ references }: { references: ReadonlyArray<ResolvedReference> }) {
  if (references.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {references.map(({ ref, title }) => {
        const Icon = ref._tag === "run" ? PlayIcon : FileTextIcon;
        return (
          <span key={ref._tag === "thread" ? ref.id : `${ref.repo}#${ref.jobId}`} className="flex max-w-80 items-center gap-1.5 rounded-md bg-muted/60 px-2 py-1 text-xs">
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{title}</span>
          </span>
        );
      })}
    </div>
  );
}
