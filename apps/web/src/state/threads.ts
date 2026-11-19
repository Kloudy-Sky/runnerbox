import type { JobRun, ThreadSubject } from "@runnerbox/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { AsyncResult, Atom } from "effect/reactivity";
import type { ReferenceCandidate } from "../lib/composerReferences.ts";
import { dataUrlOf } from "../lib/dataUrl.ts";
import { jobName } from "../lib/format.ts";
import { latest, polledOrFailed } from "../lib/polled.ts";
import { connectedAtom } from "./connections.ts";

// What the thread dock asks of a machine besides the thread's own live stream, as atoms: who runs
// its turns, the threads on a subject, whether a job can be reproduced, what `@` can refer to, and
// a sent image's bytes.

const KEPT = "5 minutes";

// The provider this session's turns run on, asked once per connection. It refuses a session the
// server won't let run threads, whatever scopes it was paired with.
export const threadProviderAtom = Atom.family((environmentId: string) =>
  Atom.make((get) => {
    const connection = get(connectedAtom(environmentId));
    return connection === null ? Effect.never : connection.client["threads.provider"]();
  }).pipe(Atom.setIdleTTL(KEPT)),
);

// A subject's threads, the newest first, once the server has said this session may run them.
// Asked every minute, since another window can start one, and at once after this one starts or
// deletes one. A subject the page doesn't know yet (null) is never asked about.
export const subjectThreadsAtom = Atom.family(({ environmentId, subject }: { readonly environmentId: string; readonly subject: ThreadSubject | null }) =>
  Atom.make((get) => {
    const connection = get(connectedAtom(environmentId));
    if (connection === null || subject === null || !AsyncResult.isSuccess(get(threadProviderAtom(environmentId)))) return Stream.never;
    return polledOrFailed(connection.client["threads.list"]({ subject }), "60 seconds");
  }).pipe(latest, Atom.setIdleTTL(KEPT)),
);

// Whether a thread's job can be reproduced, and whether this session may: the server decides.
// Asked each minute while the thread is open, so once a container runs the server notices `up`
// removed it.
export const reproduceCheckAtom = Atom.family(({ environmentId, threadId }: { readonly environmentId: string; readonly threadId: string }) =>
  Atom.make((get) => {
    const connection = get(connectedAtom(environmentId));
    return connection === null ? Stream.never : polledOrFailed(connection.client["threads.checkReproduce"]({ id: threadId }), "60 seconds");
  }).pipe(latest, Atom.setIdleTTL(KEPT)),
);

const RUNS_PER_REPO = 50;

// A run's name in the list, its chip and the sent question. When a run was retried, each attempt
// says which it is, the first included, so the two can be told apart.
const attemptKey = (run: JobRun) => `${run.repo}#${run.runId}#${run.job}`;
const runLabel = (run: JobRun, retried: ReadonlySet<string>) => `${jobName(run)} #${run.runId}${retried.has(attemptKey(run)) || run.attempt > 1 ? `, attempt ${run.attempt}` : ""}`;

// What `@` can refer to on a machine: its threads, newest first, then recent runs in each repo.
// Kept half a minute after the menu closes, so opening it again soon shows it at once.
export const referenceCandidatesAtom = Atom.family(({ environmentId, days }: { readonly environmentId: string; readonly days: number }) =>
  Atom.make((get) => {
    const connection = get(connectedAtom(environmentId));
    if (connection === null) return Effect.never;
    const { client } = connection;
    return Effect.gen(function* () {
      const threads = yield* client["threads.list"]({});
      const repos = yield* client["history.repos"]();
      const runs = yield* Effect.forEach(repos, (repo) => client["history.runs"]({ repo, days, limit: RUNS_PER_REPO }), { concurrency: "unbounded" });
      const fromThreads = threads.map((thread): ReferenceCandidate => ({ kind: "thread", id: thread.id, label: thread.title, detail: "thread" }));
      const allRuns = runs.flat();
      const retried = new Set(allRuns.filter((run) => run.attempt > 1).map(attemptKey));
      const fromRuns = allRuns.map((run): ReferenceCandidate => ({ kind: "run", repo: run.repo, jobId: run.jobId, days, label: runLabel(run, retried), detail: `run, ${run.conclusion ?? "running"}` }));
      return [...fromThreads, ...fromRuns];
    });
  }).pipe(Atom.setIdleTTL("30 seconds")),
);

const bytesOf = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

type SentImage = { readonly environmentId: string; readonly threadId: string; readonly id: string; readonly mimeType: string };

// A sent image's bytes, fetched back from the server in chunks once, as a `data:` URL of the type
// the server read from them. A sent image never changes.
export const sentImageAtom = Atom.family(({ environmentId, threadId, id, mimeType }: SentImage) =>
  Atom.make((get) => {
    const connection = get(connectedAtom(environmentId));
    if (connection === null) return Effect.never;
    return Stream.runCollect(connection.client["threads.attachment"]({ threadId, id })).pipe(Effect.flatMap((chunks) => Effect.promise(() => dataUrlOf(new Blob([...chunks].map(bytesOf), { type: mimeType })))));
  }).pipe(Atom.setIdleTTL(KEPT)),
);
