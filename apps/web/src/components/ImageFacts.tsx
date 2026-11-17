import type { KindState } from "@runnerbox/contracts";
import { type ImageStatus, imageStatus, oldToolNote } from "../lib/imageFacts.ts";

const TONE: Record<ImageStatus["tone"], string> = {
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  muted: "text-foreground",
};

// One kind's image: how fresh it is, in a word and a sentence, and the tools jobs find in it, with
// a sentence under any that's old. `named` puts the kind's name over it, for a machine with several.
// Shows nothing when Runnerbox on the machine reports nothing about the image yet.
export function ImageFacts({ kind, now, typicalBuildMs, named = false }: { kind: typeof KindState.Type; now: number; typicalBuildMs: number | null; named?: boolean }) {
  const status = imageStatus(kind, now, typicalBuildMs);
  const tools = (kind.tools ?? []).filter((tool) => tool.version !== null);
  if (!status && tools.length === 0) return null;
  return (
    <div className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-3 gap-y-0.5 pt-1 pb-1.5">
      {named ? <span className="col-span-2 text-muted-foreground">{kind.name}</span> : null}
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
            {tools.map((tool) =>
              oldToolNote(tool) ? (
                <span key={tool.name} className="whitespace-nowrap text-warning">
                  {tool.name} <span className="tabular-nums">{tool.version}</span> old
                </span>
              ) : (
                <span key={tool.name} className="whitespace-nowrap text-muted-foreground">
                  {tool.name} <span className="text-foreground tabular-nums">{tool.version}</span>
                </span>
              ),
            )}
          </span>
          {tools.flatMap((tool) => {
            const note = oldToolNote(tool);
            return note ? [<span key={`${tool.name}-gap`} />, <span key={`${tool.name}-note`} className="text-muted-foreground">{note}</span>] : [];
          })}
        </>
      ) : null}
    </div>
  );
}
