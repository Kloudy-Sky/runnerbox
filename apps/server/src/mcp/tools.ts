import { Days, GroupBy, InboxItem, InstallState, JobRun, JobSummary, LauncherEvent, MachineSample, Overview, RepoName, StepComparison, WeeklySummary } from "@runnerbox/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

// The read-only capabilities of the RPC, as tools for an agent the user already runs. None changes
// anything, and each is marked so, which lets clients run them without asking.

export const ToolFailure = Schema.Struct({ message: Schema.String });

const days = Days.pipe(Schema.withDecodingDefault(Effect.succeed(7))).annotate({ description: "How many days back, 1 to 90. Default 7." });
const by = GroupBy.pipe(Schema.withDecodingDefault(Effect.succeed("labels" as const))).annotate({
  description: "`labels` groups by the runs-on labels a job asked for; `runner` by runner name without its trailing numbers, which tells two launchers on one label apart.",
});
const repo = RepoName.annotate({ description: "owner/name, as list_repos returns it." });

const READ_ONLY = Context.make(Tool.Readonly, true).pipe(Context.add(Tool.Destructive, false));
const shared = { failure: ToolFailure, failureMode: "return" as const };

export const RunnerboxToolkit = Toolkit.make(
  Tool.make("list_repos", { ...shared, description: "Repos with job history on this machine.", success: Schema.Array(Schema.String) }).annotateMerge(READ_ONLY),
  Tool.make("ci_inbox", {
      ...shared,
      description:
        "What CI needs from the person running these runners: failures with a verdict (code, flaky, infra, unconfirmed) and the evidence for it, jobs that never got a runner, slots that keep failing, and jobs slower than their own history. `needs_you` items come first.",
      parameters: Schema.Struct({ days }),
      success: Schema.Array(InboxItem),
    }).annotateMerge(READ_ONLY),
  Tool.make("ci_overview", { ...shared, description: "Totals across every repo: jobs, failures, retries that passed, jobs without a runner, median times.", parameters: Schema.Struct({ days }), success: Overview }).annotateMerge(READ_ONLY),
  Tool.make("job_summaries", {
      ...shared,
      description: "Per job and runner type: runs, failures, P50 and P90 times, queue times, and the VM's memory while the jobs ran. Sorted by total runner time.",
      parameters: Schema.Struct({ repo, days, by, workflow: Schema.optionalKey(Schema.String) }),
      success: Schema.Array(JobSummary),
    }).annotateMerge(READ_ONLY),
  Tool.make("step_comparison", {
      ...shared,
      description: "Median time of each step of one job, per runner type, from passing runs. Shows where a slower runner spends its time.",
      parameters: Schema.Struct({ repo, job: Schema.String, days, by, workflow: Schema.optionalKey(Schema.String) }),
      success: StepComparison,
    }).annotateMerge(READ_ONLY),
  Tool.make("list_runs", {
      ...shared,
      description: "Job attempts, newest first, with branch, runner, times and a verdict on failures.",
      parameters: Schema.Struct({ repo, days, limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 500 })).pipe(Schema.withDecodingDefault(Effect.succeed(100))) }),
      success: Schema.Array(JobRun),
    }).annotateMerge(READ_ONLY),
  Tool.make("weekly_summary", { ...shared, description: "The same tables as `runnerbox summary`: jobs, what the launcher did, and machine headroom.", parameters: Schema.Struct({ repo, days, by }), success: WeeklySummary }).annotateMerge(READ_ONLY),
  Tool.make("launcher_events", { ...shared, description: "What `up` recorded: each runner with its exit code, memory waits and image builds.", parameters: Schema.Struct({ days }), success: Schema.Array(LauncherEvent) }).annotateMerge(READ_ONLY),
  Tool.make("machine_samples", {
      ...shared,
      description: "Host and VM memory, swap, load and CPU, thinned to at most `maxPoints` per install, keeping each stretch's lowest available memory.",
      parameters: Schema.Struct({ days, maxPoints: Schema.Int.check(Schema.isBetween({ minimum: 10, maximum: 2000 })).pipe(Schema.withDecodingDefault(Effect.succeed(200))) }),
      success: Schema.Array(MachineSample),
    }).annotateMerge(READ_ONLY),
  Tool.make("runner_state", { ...shared, description: "What each slot of each running `up` is doing now, and each kind's image. `stale` means `up` stopped updating it.", success: Schema.Array(InstallState) }).annotateMerge(READ_ONLY),
);
