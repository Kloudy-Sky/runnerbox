import { formatDuration } from "../../lib/format.ts";
import { hours } from "./words.ts";

type Props = {
  readonly ownMs: number;
  readonly githubMs: number | null;
  // Your machines' share of all job time, from job history, so both sides cover the same jobs.
  readonly ownShare: number | null;
  readonly typicalJobMs: number | null;
  readonly typicalWaitMs: number | null;
};

// The totals under the savings figure: where jobs ran, and how long a typical one took and waited.
export function Facts({ ownMs, githubMs, ownShare, typicalJobMs, typicalWaitMs }: Props) {
  const fact = (label: string, value: string, note?: string) => (
    <div className="flex min-w-0 flex-col">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-2xl font-medium">{value}</span>
      {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
    </div>
  );
  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-4 min-[720px]:grid-cols-4">
      {fact("On your machines", hours(ownMs), ownShare !== null ? `${Math.round(ownShare * 100)}% of all job time` : undefined)}
      {fact("On GitHub's", githubMs === null ? "-" : hours(githubMs))}
      {fact("Typical job", formatDuration(typicalJobMs))}
      {fact("Typical wait", formatDuration(typicalWaitMs), "for a runner")}
    </div>
  );
}
