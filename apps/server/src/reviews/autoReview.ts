import type { PullRequest, Review } from "@runnerbox/contracts";

// Which pull requests are reviewed without anyone pressing Review. These are fixed, not settings:
// the owner picks the repositories, and the rest is here.

// A pull request as the list has it, with what decides whether it's reviewed unasked.
export type ListedPull = PullRequest & { readonly bot: boolean; readonly fork: boolean };

// A push is reviewed once it has been quiet this long, so a run of pushes gets one review.
export const QUIET_MS = 60_000;
// Reviews started unasked in any 24 hours. Pressing Review isn't counted or held back.
export const MAX_AUTO_PER_DAY = 40;
const DAY_MS = 24 * 3_600_000;

// Why a pull request is never reviewed unasked, whatever is pushed to it.
export function skipOf(pull: ListedPull) {
  if (pull.draft) return "draft" as const;
  if (pull.bot) return "bot" as const;
  if (pull.fork) return "fork" as const;
  return null;
}

// `since` is when the owner turned reviews on for the repository, and `reviews` the pull request's
// own. A pull request opened after that is reviewed, and so is every later push. One opened before
// is left alone until the owner reviews it once, so turning a repository on never starts a review
// of everything open. A commit that has a review, however it ended, isn't reviewed again.
export function wantsReview(pull: ListedPull, known: { readonly since: string | undefined; readonly reviews: ReadonlyArray<Review>; readonly now: number }) {
  if (skipOf(pull) !== null || pull.headSha === "") return false;
  if (known.reviews.some((review) => review.headSha === pull.headSha)) return false;
  if (known.now - Date.parse(pull.updatedAt) < QUIET_MS) return false;
  return known.reviews.length > 0 || (known.since !== undefined && Date.parse(pull.openedAt) > Date.parse(known.since));
}

// The starts still inside the last 24 hours, and whether one more fits.
export function autoBudget(started: ReadonlyArray<string>, now: number) {
  const recent = started.filter((at) => now - Date.parse(at) < DAY_MS);
  return { recent, room: recent.length < MAX_AUTO_PER_DAY };
}
