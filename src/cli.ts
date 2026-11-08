#!/usr/bin/env node
import { parseArgs } from "node:util";
import { createGitHubClient, REPO_NAME, resolveToken } from "./github/github-client.ts";
import { startRunners } from "./launcher/start-runners.ts";
import { formatStepComparison, formatSummary } from "./tracking/format-report.ts";
import { createJobLog, defaultLogPath } from "./tracking/job-log.ts";
import { compareSteps, summarizeJobs } from "./tracking/report.ts";
import { DAY_MS, syncJobs } from "./tracking/sync-jobs.ts";
import { renderVm } from "./vm/render-vm.ts";
import { loadVmConfig } from "./vm/vm-config.ts";

const USAGE = `Usage:
  runnerbox up --config <file>
  runnerbox vm render --config <file> --out <dir>
  runnerbox report --repo <owner/name> [options]

up: keeps runners waiting for jobs in the VM until stopped.
vm render: writes the VM's cloud-init seed, firewall and a create.sh to run on the host.
report: copies job history from GitHub to a local log, then summarizes it.

Report options:
  --repo <owner/name>  Repository to report on
  --since <days>d      How far back to report (default: 7d)
  --workflow <name>    Only include this workflow
  --job <name>         Compare one job's steps across runner types
  --offline            Report from the local log without calling GitHub
  --help               Show this message`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: "string" },
      out: { type: "string" },
      repo: { type: "string" },
      since: { type: "string", default: "7d" },
      workflow: { type: "string" },
      job: { type: "string" },
      offline: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });

  if (values.help) return console.log(USAGE);

  if (positionals[0] === "up" && positionals.length === 1 && values.config) {
    return startRunners(values.config);
  }

  if (positionals[0] === "vm" && positionals[1] === "render" && positionals.length === 2 && values.config && values.out) {
    const written = await renderVm(await loadVmConfig(values.config), values.out);
    return console.log(`Wrote ${written.join(", ")} to ${values.out}. Review create.sh, then run it on the host.`);
  }

  const { repo, since: sinceArg, workflow, job, offline } = values;
  const days = /^(\d+)d$/.exec(sinceArg)?.[1];
  if (
    positionals[0] !== "report" ||
    positionals.length !== 1 ||
    !repo ||
    !REPO_NAME.test(repo) ||
    !days
  ) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }

  const until = new Date();
  const since = new Date(until.getTime() - Number(days) * DAY_MS);
  const store = createJobLog(defaultLogPath(repo));

  if (!offline) {
    console.error(`Syncing ${repo} since ${since.toISOString().slice(0, 10)}...`);
    const source = createGitHubClient(resolveToken());
    const onRunSynced = (added: number) => {
      if (process.stderr.isTTY) process.stderr.write(`\r${added} jobs added`);
    };
    const added = await syncJobs({ repo, since, until, source, store, onRunSynced });
    if (process.stderr.isTTY) process.stderr.write("\n");
    console.error(`Added ${added} jobs to ${store.path}`);
  }

  const records = (await store.read()).filter(
    (record) =>
      Date.parse(record.createdAt) >= since.getTime() && (workflow === undefined || record.workflow === workflow),
  );

  if (!job) return console.log(formatSummary(summarizeJobs(records)));

  const workflows = new Set(records.filter((record) => record.job === job).map((record) => record.workflow));
  if (workflows.size > 1) {
    throw new Error(`Job "${job}" is in ${workflows.size} workflows. Pick one with --workflow.`);
  }
  console.log(formatStepComparison(compareSteps(records, job)));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  // Exit outright. Other slots may still be looping, and a service manager needs to restart them.
  process.exit(1);
});
