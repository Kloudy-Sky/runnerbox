import type { Inbox, InboxItem, InstallState, JobRun, LauncherEvent } from "@runnerbox/contracts";

const HOUR_MS = 3_600_000;

// With no report from the machine, `now` is 0 and nothing is recent.
const withinHour = (iso: string, now: number) => {
  const age = now - Date.parse(iso);
  return age >= 0 && age < HOUR_MS;
};

// What the Now view pins at its top: everything that needs the owner, then jobs that failed in
// their own code in the last hour. Those are the code's, and leave once a later run passes, which
// moves them out of the inbox's "own code" group, or after an hour.
export function pinned(inbox: Inbox, now: number) {
  const code = inbox.quiet
    .filter((group) => group.kind === "own_code")
    .flatMap((group) => group.items)
    .filter((item) => withinHour(item.at, now));
  return [...inbox.items.map((item) => ({ item, kind: "needs_you" as const })), ...code.map((item) => ({ item, kind: "code" as const }))];
}

// The job a code failure points at, for opening its run thread. Its latest attempt.
export const failedJobId = (item: InboxItem) => item.evidence.attempts.at(-1)?.jobId ?? null;

// Finished jobs on this machine's runners in the last hour, newest first.
export function lastHour(runs: ReadonlyArray<JobRun>, runnerNames: ReadonlySet<string>, now: number) {
  return runs
    .filter((run) => run.runner !== null && runnerNames.has(run.runner) && run.completedAt !== null && withinHour(run.completedAt, now))
    .toSorted((a, b) => Date.parse(b.completedAt ?? "") - Date.parse(a.completedAt ?? ""));
}

export type LaneBlock = { start: number; end: number; outcome: "passed" | "failed" | "running" | "unknown" };
export type Lane = { install: string; kind: string; slot: number; blocks: LaneBlock[] };

// Each slot's last hour as blocks of work, as fractions of the hour (0 is an hour ago, 1 is now).
// A runner's time comes from its job when the job is known, so the wait before a job isn't drawn
// as work. Runners released unused did no work and aren't drawn.
export function lanes(installs: ReadonlyArray<InstallState>, events: ReadonlyArray<LauncherEvent>, runs: ReadonlyArray<JobRun>, now: number): Lane[] {
  const from = now - HOUR_MS;
  const fraction = (ms: number) => Math.min(1, Math.max(0, (ms - from) / HOUR_MS));
  const runByRunner = new Map(runs.flatMap((run) => (run.runner ? [[run.runner, run] as const] : [])));
  const outcome = (run: JobRun | undefined): LaneBlock["outcome"] =>
    run?.conclusion === "success" ? "passed" : run?.conclusion === "failure" ? "failed" : "unknown";

  return installs.flatMap((install) =>
    install.kinds.flatMap((kind) =>
      kind.slots.map((slot) => {
        const finished = events.flatMap((event) => {
          if (event.event !== "runner" || event.released || event.install !== install.install || event.runnerType !== kind.name || event.slot !== slot.slot) return [];
          const run = runByRunner.get(event.runner);
          const start = run?.startedAt ? Date.parse(run.startedAt) : Date.parse(event.startedAt);
          const end = run?.startedAt && run.durationMs !== null ? start + run.durationMs : Date.parse(event.startedAt) + event.durationMs;
          return end < from ? [] : [{ start: fraction(start), end: fraction(end), outcome: outcome(run) }];
        });
        const running = slot.phase === "busy" ? [{ start: fraction(Date.parse(slot.since)), end: 1, outcome: "running" as const }] : [];
        return { install: install.install, kind: kind.name, slot: slot.slot, blocks: [...finished, ...running] };
      }),
    ),
  );
}

// How much of the hour the slots spent on jobs, 0 to 1.
export function busyShare(all: ReadonlyArray<Lane>) {
  if (all.length === 0) return 0;
  const covered = all.map((lane) => Math.min(1, lane.blocks.reduce((sum, block) => sum + (block.end - block.start), 0)));
  return covered.reduce((sum, value) => sum + value, 0) / all.length;
}
