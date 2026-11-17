import type { Check, PullRequest, ReviewsView } from "@runnerbox/contracts";

// A pull request, the machine whose answer it's shown from, which its review buttons ask, and that answer.
export type MachinePull = { readonly pull: PullRequest; readonly environmentId: string; readonly view: ReviewsView };

const checkKey = (check: Check) => `${check.workflow ?? ""}\0${check.name}`;
const reviewedAt = (pull: PullRequest) => (pull.review ? Date.parse(pull.review.startedAt) : Number.NEGATIVE_INFINITY);

// Every machine's open pull requests as one list, matched on repository and number. A review runs
// on one machine and is kept there, so each pull request comes from the machine with its newest
// review, or else one that can review. Checks from each machine's own job history are added where
// the kept answer lacks them. A machine with no answer adds nothing. Newest change first.
export function pullsEverywhere(answers: ReadonlyArray<{ readonly environmentId: string; readonly view: ReviewsView | undefined }>): MachinePull[] {
  const byPull = new Map<string, MachinePull[]>();
  for (const { environmentId, view } of answers) {
    if (view === undefined) continue;
    for (const pull of view.pulls) {
      const key = `${pull.repo}#${pull.number}`;
      byPull.set(key, [...(byPull.get(key) ?? []), { pull, environmentId, view }]);
    }
  }
  return [...byPull.values()]
    .map((copies) => {
      const kept = copies.toSorted((a, b) => reviewedAt(b.pull) - reviewedAt(a.pull) || Number(b.view.canReview ?? false) - Number(a.view.canReview ?? false))[0]!;
      const reported = copies.flatMap((copy) => (copy.pull.checks === undefined ? [] : [copy.pull.checks]));
      if (reported.length === 0) return kept;
      const checks = new Map<string, Check>();
      for (const check of [...(kept.pull.checks ?? []), ...reported.flat()]) if (!checks.has(checkKey(check))) checks.set(checkKey(check), check);
      return { ...kept, pull: { ...kept.pull, checks: [...checks.values()] } };
    })
    .toSorted((a, b) => Date.parse(b.pull.updatedAt) - Date.parse(a.pull.updatedAt));
}
