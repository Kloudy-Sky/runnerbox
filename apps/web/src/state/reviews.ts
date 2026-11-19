import type { ReviewsView } from "@runnerbox/contracts";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import { AsyncResult, Atom } from "effect/reactivity";
import { polled } from "../lib/polled.ts";
import { going } from "../lib/reviewWords.ts";
import { capabilitiesOf } from "../lib/serverCapabilities.ts";
import { connectedAtom, environmentsAtom, serverMethodsAtom } from "./connections.ts";

// Each machine's reviews as atoms: the repositories its GitHub App is installed on, their open pull
// requests with each one's newest review, and one pull request's reviews as the machine keeps them.

// How long an answer outlives the last page that read it, so coming back shows it at once.
const KEPT = "5 minutes";

const reviewing = (view: ReviewsView) => view.pulls.some((pull) => going(pull.review));

// The view as the server last answered it, on a server that has reviews. Asked every half minute,
// since pull requests change on GitHub's own time, and every few seconds while a review runs.
const askedAtom = Atom.family((environmentId: string) =>
  Atom.make((get) => {
    const connection = get(connectedAtom(environmentId));
    const methods = AsyncResult.value(get(serverMethodsAtom(environmentId)));
    if (connection === null || Option.isNone(methods) || !capabilitiesOf(methods.value).reviews) return Stream.never;
    return polled(connection.client["reviews.status"](), "30 seconds", { every: "3 seconds", when: reviewing });
  }).pipe(Atom.setIdleTTL(KEPT)),
);

// The view, which a settings change also writes: `reviews.setRepo` and `reviews.setModel` answer
// with the view as it now is, which shows until the next answer. Refreshing asks again at once.
export const reviewsAtom = Atom.family((environmentId: string) =>
  Atom.writable(
    (get) => get(askedAtom(environmentId)),
    (ctx, view: ReviewsView) => ctx.setSelf(AsyncResult.success(view)),
    (refresh) => refresh(askedAtom(environmentId)),
  ).pipe(Atom.setIdleTTL(KEPT)),
);

// Every saved machine's view, where it has one. `older` is true for a machine whose server answers
// without reviews, so a page can say to update it.
export const reviewsEverywhereAtom = Atom.readable((get) =>
  get(environmentsAtom).map((environment) => {
    const methods = AsyncResult.value(get(serverMethodsAtom(environment.environmentId)));
    return {
      environment,
      view: Option.getOrUndefined(AsyncResult.value(get(reviewsAtom(environment.environmentId)))),
      older: Option.isSome(methods) && !capabilitiesOf(methods.value).reviews,
    };
  }),
);

type PullKey = { readonly environmentId: string; readonly repo: string; readonly number: number };

// One pull request's newest review as its machine's view lists it, as one string, so its reviews
// are asked again when a review starts or finishes there, and not on every answer.
const newestListedAtom = Atom.family(({ environmentId, repo, number }: PullKey) =>
  Atom.readable((get) => {
    const view = Option.getOrUndefined(AsyncResult.value(get(reviewsAtom(environmentId))));
    const review = view?.pulls.find((pull) => pull.repo === repo && pull.number === number)?.review;
    return review === undefined ? "" : `${review.id} ${review.state}`;
  }),
);

// One pull request's reviews as the machine that ran them keeps them, the newest first. Asked
// again when the machine's view lists a new review or state for it, and every few seconds while
// the newest is still going: a finished review never changes. A failed ask is tried twice more
// before the failure shows, beside what it last answered.
export const pullReviewsAtom = Atom.family((key: PullKey) =>
  Atom.make((get) => {
    get(newestListedAtom(key));
    const connection = get(connectedAtom(key.environmentId));
    if (connection === null) return Stream.never;
    return Stream.fromEffectSchedule(connection.client["reviews.read"]({ repo: key.repo, number: key.number }), Schedule.spaced("3 seconds")).pipe(
      Stream.takeUntil((kept) => !going(kept.reviews[0])),
      Stream.retry(Schedule.max([Schedule.spaced("3 seconds"), Schedule.recurs(2)])),
    );
  }).pipe(Atom.setIdleTTL(KEPT)),
);
