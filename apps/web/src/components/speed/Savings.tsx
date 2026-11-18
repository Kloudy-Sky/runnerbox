import { cents, dollars, hours, rangeWords } from "./words.ts";

type Props = {
  readonly usd: number | null;
  readonly ownMs: number;
  readonly pricesReadOn: string | null;
  readonly days: number;
  // What reviews spent on the owner's Claude account over the same days, or null with none.
  readonly reviewUsd: number | null;
};

// The page's one large figure: what GitHub would have charged for the time jobs ran on the
// owner's machines. It's an estimate at prices read on a date, and says so under it.
export function Savings({ usd, ownMs, pricesReadOn, days, reviewUsd }: Props) {
  const readOn = pricesReadOn ? new Date(`${pricesReadOn}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null;
  if (usd === null) return <p className="text-muted-foreground">No time on your machines to price in {rangeWords(days)}.</p>;
  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
      <b className="text-6xl leading-none font-semibold">{dollars(usd)}</b>
      <div className="flex max-w-xl flex-col gap-0.5 pb-0.5">
        <span>
          GitHub would have charged about {dollars(usd)} for the {hours(ownMs)} your machines ran jobs in {rangeWords(days)}.
          {reviewUsd !== null ? ` Reviews cost ${cents(reviewUsd)} on your Claude account.` : ""}
        </span>
        <span className="text-muted-foreground">An estimate at GitHub's prices on {readOn ?? "a recent date"}.</span>
      </div>
    </div>
  );
}
