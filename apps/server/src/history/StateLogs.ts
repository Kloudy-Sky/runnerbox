import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { LauncherEvent } from "@runnerbox/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { readInstallLogs } from "runnerbox/src/tracking/install-logs.ts";
import { createJobLog } from "runnerbox/src/tracking/job-log.ts";
import type { JobRecord } from "runnerbox/src/tracking/job-record.ts";
import { LauncherEventRecord } from "runnerbox/src/tracking/launcher-event.ts";
import { type InstallSample, readSamples } from "runnerbox/src/tracking/sample-log.ts";
import * as ServerPaths from "../config/ServerPaths.ts";

export class LogReadError extends Schema.TaggedError<LogReadError>()("LogReadError", {
  what: Schema.Literals(["job log", "samples", "launcher events", "runner state"]),
  cause: Schema.Defect(),
}) {
  override get message() {
    return `Couldn't read the ${this.what}.`;
  }
}

// `report` names a repo's job log `<owner>__<name>.ndjson`. Owners can't contain `__`.
const JOB_LOG = /^(.+?)__(.+)\.ndjson$/;

// The logs `report` and `up` write, read through the core's own parsers, limited to records that
// started at or after `since` (epoch ms).
export class StateLogs extends Context.Service<
  StateLogs,
  {
    readonly repos: Effect.Effect<ReadonlyArray<string>, LogReadError>;
    readonly jobs: (repo: string, since: number) => Effect.Effect<ReadonlyArray<JobRecord>, LogReadError>;
    readonly allJobs: (since: number) => Effect.Effect<ReadonlyArray<JobRecord>, LogReadError>;
    readonly samples: (since: number) => Effect.Effect<ReadonlyArray<InstallSample>, LogReadError>;
    readonly events: (since: number) => Effect.Effect<ReadonlyArray<LauncherEvent>, LogReadError>;
  }
>()("runnerbox/server/StateLogs") {}

const make = Effect.gen(function* () {
  const { stateDir } = yield* ServerPaths.ServerPaths;

  const repos = Effect.tryPromise({
    try: async () => {
      const entries = await readdir(stateDir, { withFileTypes: true }).catch(() => []);
      return entries
        .filter((entry) => entry.isFile())
        .flatMap((entry) => {
          const match = JOB_LOG.exec(entry.name);
          return match ? [`${match[1]}/${match[2]}`] : [];
        })
        .toSorted();
    },
    catch: (cause) => new LogReadError({ what: "job log", cause }),
  });

  const jobs = Effect.fn("StateLogs.jobs")(function* (repo: string, since: number) {
    const records = yield* Effect.tryPromise({
      try: () => createJobLog(join(stateDir, `${repo.replace("/", "__")}.ndjson`)).read(),
      catch: (cause) => new LogReadError({ what: "job log", cause }),
    });
    return records.filter((record) => Date.parse(record.createdAt) >= since);
  });

  const allJobs = Effect.fn("StateLogs.allJobs")(function* (since: number) {
    const lists = yield* Effect.forEach(yield* repos, (repo) => jobs(repo, since));
    return lists.flat();
  });

  const samples = Effect.fn("StateLogs.samples")(function* (since: number) {
    const all = yield* Effect.tryPromise({
      try: () => readSamples(stateDir),
      catch: (cause) => new LogReadError({ what: "samples", cause }),
    });
    return all.filter(({ sample }) => Date.parse(sample.time) >= since);
  });

  const events = Effect.fn("StateLogs.events")(function* (since: number) {
    const entries = yield* Effect.tryPromise({
      try: () => readInstallLogs(stateDir, "events.ndjson", LauncherEventRecord),
      catch: (cause) => new LogReadError({ what: "launcher events", cause }),
    });
    return entries
      .filter(({ record }) => Date.parse(record.startedAt) >= since)
      .map(({ install, record }): LauncherEvent => {
        // Each line also carries `time`, when it was written, which the wire doesn't need.
        const { time: _time, ...fields } = record as typeof record & { time?: string };
        return { install, ...fields };
      })
      .toSorted((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  });

  return StateLogs.of({ repos, jobs, allJobs, samples, events });
});

export const layer = Layer.effect(StateLogs, make);
