import * as Effect from "effect/Effect";
import type { LogReadError } from "../history/StateLogs.ts";
import * as JobHistory from "../history/JobHistory.ts";
import * as Inbox from "../inbox/Inbox.ts";
import * as Proposals from "../proposals/Proposals.ts";
import * as LauncherLogs from "../runners/LauncherLogs.ts";
import * as RunnerState from "../runners/RunnerState.ts";
import { RunnerboxToolkit } from "./tools.ts";

const toFailure = Effect.mapError((error: LogReadError) => ({ message: error.message }));

// Each tool calls one service method, the same one its RPC calls.
export const layer = RunnerboxToolkit.toLayer(
  Effect.gen(function* () {
    const history = yield* JobHistory.JobHistory;
    const launcher = yield* LauncherLogs.LauncherLogs;
    const inbox = yield* Inbox.Inbox;
    const runners = yield* RunnerState.RunnerState;
    const proposals = yield* Proposals.Proposals;
    return {
      list_repos: () => history.repos.pipe(toFailure),
      ci_inbox: ({ days }) => inbox.list(days).pipe(toFailure),
      ci_overview: ({ days }) => history.overview(days).pipe(toFailure),
      job_summaries: (input) => history.jobSummaries(input).pipe(toFailure),
      step_comparison: (input) => history.stepComparison(input).pipe(toFailure),
      list_runs: (input) => history.runs(input).pipe(toFailure),
      weekly_summary: (input) => history.weeklySummary(input).pipe(toFailure),
      launcher_events: ({ days }) => launcher.events(days).pipe(toFailure),
      machine_samples: ({ days, maxPoints }) => launcher.samples(days, maxPoints).pipe(toFailure),
      runner_state: () => runners.current.pipe(toFailure),
      install_settings: ({ install }) => proposals.settings(install).pipe(Effect.map(({ ok: _ok, ...settings }) => settings), Effect.mapError((error) => ({ message: error.why }))),
    };
  }),
);
