import { formatDuration } from "../../lib/format.ts";

type Props = {
  readonly ownMs: number;
  readonly githubMs: number;
  readonly typicalJobMs: number | null;
  readonly typicalWaitMs: number | null;
  readonly cost: { readonly usd: number } | null;
  readonly pricesReadOn: string | null;
};

// The window in five numbers, across every repository: where jobs ran, how long a typical one took
// and waited, and what GitHub would have charged for the time on the owner's machines.
export function Facts({ ownMs, githubMs, typicalJobMs, typicalWaitMs, cost, pricesReadOn }: Props) {
  const fact = (value: string, label: string) => (
    <div className="flex max-w-64 flex-col">
      <span className="text-base text-foreground tabular-nums">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
  return (
    <div className="flex flex-wrap gap-x-8 gap-y-3">
      {fact(formatDuration(ownMs), "on your machines")}
      {fact(formatDuration(githubMs), "on GitHub's machines")}
      {fact(formatDuration(typicalJobMs), "typical job")}
      {fact(formatDuration(typicalWaitMs), "typical wait for a runner")}
      {cost ? fact(`about $${cost.usd.toFixed(2)}`, `what GitHub would have charged for that time, an estimate at its prices on ${pricesReadOn ? new Date(`${pricesReadOn}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "a recent date"}`) : null}
    </div>
  );
}
