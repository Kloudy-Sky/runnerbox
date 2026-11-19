import type { MonitorStatus } from "@runnerbox/contracts";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import { AsyncResult, Atom } from "effect/reactivity";
import { polled } from "../lib/polled.ts";
import { connectedAtom, environmentsAtom } from "./connections.ts";
import { accountAtom } from "./github.ts";
import { reviewsAtom } from "./reviews.ts";

// What each machine's Inbox is built from, as atoms: its items over a range, its monitor, and its
// proposals. A server older than one of these refuses it, and the machine shows without it.

// How long an answer outlives the last page that read it, so coming back shows it at once.
const KEPT = "5 minutes";

const valueOf = <A, E>(result: AsyncResult.AsyncResult<A, E>) => Option.getOrUndefined(AsyncResult.value(result));

// Counted up after a write that changes a machine's items, so every range of them asks again.
export const inboxWrittenAtom = Atom.family((_environmentId: string) => Atom.make(0));

// A machine's items over the last `days`, asked every minute, since items come and go as jobs run.
// A failed ask is tried once more, then the failure shows beside what it last answered, so a page
// that waits for the items, such as Speed and cost, goes on without them. A write, a new range or
// a reconnect asks again.
export const inboxAtom = Atom.family(({ environmentId, days }: { readonly environmentId: string; readonly days: number }) =>
  Atom.make((get) => {
    get(inboxWrittenAtom(environmentId));
    const connection = get(connectedAtom(environmentId));
    if (connection === null) return Stream.never;
    return Stream.fromEffectSchedule(connection.client["inbox.list"]({ days }), Schedule.spaced("60 seconds")).pipe(Stream.retry(Schedule.max([Schedule.spaced("3 seconds"), Schedule.recurs(1)])));
  }).pipe(Atom.setIdleTTL(KEPT)),
);

// A machine's monitor as the server last answered: its settings, today's looks, recent runs and the
// items it looked into that the owner hasn't opened. Asked every minute, since it runs on its own.
const monitorsAskedAtom = Atom.family((environmentId: string) =>
  Atom.make((get) => {
    const connection = get(connectedAtom(environmentId));
    return connection === null ? Stream.never : polled(connection.client["monitors.status"](), "60 seconds");
  }).pipe(Atom.setIdleTTL(KEPT)),
);

// The monitor, which saving its settings also writes: `monitors.save` answers with the status as it
// now is, which shows until the next answer.
export const monitorsAtom = Atom.family((environmentId: string) =>
  Atom.writable(
    (get) => get(monitorsAskedAtom(environmentId)),
    (ctx, status: MonitorStatus) => ctx.setSelf(AsyncResult.success(status)),
    (refresh) => refresh(monitorsAskedAtom(environmentId)),
  ).pipe(Atom.setIdleTTL(KEPT)),
);

// A machine's proposals and whether this session may decide them, asked every 15 seconds, since
// `up` applies an approved change on its own time.
export const proposalsAtom = Atom.family((environmentId: string) =>
  Atom.make((get) => {
    const connection = get(connectedAtom(environmentId));
    return connection === null ? Stream.never : polled(connection.client["proposals.list"](), "15 seconds");
  }).pipe(Atom.setIdleTTL(KEPT)),
);

// Every saved machine's items over the last `days`, each undefined until it answers, for what counts
// or links to them without the rest of the Inbox.
export const inboxesAtom = Atom.family((days: number) =>
  Atom.readable((get) => get(environmentsAtom).map(({ environmentId }) => ({ environmentId, inbox: valueOf(get(inboxAtom({ environmentId, days }))) }))),
);

// Every saved machine's part of the Inbox over the last `days`: its items, monitor, reviews, GitHub
// login and proposals, each undefined until it answers.
export const inboxMachinesAtom = Atom.family((days: number) =>
  Atom.readable((get) =>
    get(environmentsAtom).map(({ environmentId, label }) => ({
      environmentId,
      label,
      inbox: valueOf(get(inboxAtom({ environmentId, days }))),
      monitors: valueOf(get(monitorsAtom(environmentId))),
      reviews: valueOf(get(reviewsAtom(environmentId))),
      login: get(accountAtom(environmentId)),
      proposals: valueOf(get(proposalsAtom(environmentId))),
    })),
  ),
);

export type InboxMachine = Atom.Type<ReturnType<typeof inboxMachinesAtom>>[number];
