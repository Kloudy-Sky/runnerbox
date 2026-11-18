import type { KindUsage } from "@runnerbox/contracts";
import { cents, dollars, hours } from "./words.ts";

// Every repository's reviews, and the picked one's when other repositories spent too.
export type ReviewSpend = { readonly reviews: number; readonly usd: number; readonly repo: { readonly name: string; readonly reviews: number; readonly usd: number } | null };

const LINE = "flex justify-between gap-4 py-0.5";

// What the window cost, as lines: each machine's time priced at GitHub's rates, and what reviews
// spent on the owner's Claude account. The large figure above already leads, so no figure here is.
// Each machine's kinds come with its label, since two machines can each have an install of the same name.
export function Costs({ machines: answers, pricesReadOn, reviews }: { readonly machines: readonly { readonly environmentId: string; readonly label: string; readonly kinds: readonly KindUsage[] }[]; readonly pricesReadOn: string; readonly reviews: ReviewSpend | null }) {
  const priced = answers.flatMap(({ environmentId, label, kinds }) =>
    kinds.flatMap((kind) =>
      kind.cost ? [{ key: `${environmentId}\0${kind.install}`, name: kind.install === label ? label : `${kind.install} on ${label}`, ms: kind.runnerMs, usd: kind.cost.usd, size: kind.cost.size }] : [],
    ),
  );
  const machines = [...Map.groupBy(priced, (kind) => kind.key)].map(([key, own]) => ({
    key,
    name: own[0]?.name ?? "",
    ms: own.reduce((total, kind) => total + kind.ms, 0),
    usd: own.reduce((total, kind) => total + kind.usd, 0),
  }));
  const sizes = new Set(priced.map((kind) => kind.size));
  const readOn = new Date(`${pricesReadOn}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return (
    <div className="grid gap-x-10 gap-y-6 min-[900px]:grid-cols-2">
      {machines.length > 0 ? (
        <div className="flex flex-col">
          <span className="pb-1 text-muted-foreground">Your machines, priced as GitHub's {sizes.size === 1 ? `${[...sizes][0]} runners` : "runners of the nearest size"}</span>
          {machines.map((machine) => (
            <div key={machine.key} className={LINE}>
              <span>
                {machine.name}, {hours(machine.ms)}
              </span>
              <span className="tabular-nums">{dollars(machine.usd)}</span>
            </div>
          ))}
          <span className="pt-1 text-xs text-muted-foreground">An estimate at GitHub's prices on {readOn}. Your machines' electricity isn't counted.</span>
        </div>
      ) : null}
      {reviews ? (
        <div className="flex flex-col">
          <span className="pb-1 text-muted-foreground">Reviews on your Claude account</span>
          <div className={LINE}>
            <span>
              {reviews.reviews} review{reviews.reviews === 1 ? "" : "s"}
              {reviews.reviews > 0 && reviews.usd > 0 ? `, ${reviews.usd / reviews.reviews < 0.005 ? "" : "about "}${cents(reviews.usd / reviews.reviews)} each` : ""}
            </span>
            <span className="tabular-nums">{cents(reviews.usd)}</span>
          </div>
          {reviews.repo ? (
            <div className={LINE}>
              <span>
                {reviews.repo.name}, {reviews.repo.reviews} review{reviews.repo.reviews === 1 ? "" : "s"}
              </span>
              <span className="tabular-nums">{cents(reviews.repo.usd)}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
