import type { KindState } from "@runnerbox/contracts";
import { type ImageStatus, imageStatus } from "../lib/imageFacts.ts";

const TONE: Record<ImageStatus["tone"], string> = {
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  muted: "text-foreground",
};

// One kind's image: how fresh it is, in a word and a sentence, and the tools jobs find in it.
// Shows nothing when Runnerbox on the machine reports nothing about the image yet.
export function ImageFacts({ kind, now, typicalBuildMs }: { kind: typeof KindState.Type; now: number; typicalBuildMs: number | null }) {
  const status = imageStatus(kind, now, typicalBuildMs);
  const tools = (kind.tools ?? []).filter((tool) => tool.version !== null);
  if (!status && tools.length === 0) return null;
  return (
    <div className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-3 gap-y-0.5 pt-1 pb-1.5">
      {status ? (
        <>
          <span className="text-muted-foreground">Image</span>
          <span>
            <span className={TONE[status.tone]}>{status.word}</span>
            <span className="text-muted-foreground"> · {status.sentence}</span>
          </span>
          {status.progress !== null ? (
            <>
              <span />
              <span className="mt-0.5 mb-1 block h-1 max-w-64 bg-muted">
                <span className="block h-full bg-foreground/80" style={{ width: `${Math.round(status.progress * 100)}%` }} />
              </span>
            </>
          ) : null}
        </>
      ) : null}
      {tools.length > 0 ? (
        <>
          <span className="text-muted-foreground">Tools</span>
          <span className="flex flex-wrap gap-x-3 gap-y-0.5">
            {tools.map((tool) => (
              <span key={tool.name} className="whitespace-nowrap text-muted-foreground">
                {tool.name} <span className="text-foreground tabular-nums">{tool.version}</span>
              </span>
            ))}
          </span>
        </>
      ) : null}
    </div>
  );
}
