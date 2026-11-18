import type { CiJob, DockerUse, RunnerVariable } from "@runnerbox/contracts";
import { isMap, isScalar, isSeq, parseDocument, type YAMLMap } from "yaml";

// One workflow file read for Move CI: each job's `runs-on:`, and the edits that make a job naming a
// GitHub-hosted label read the runner variable instead, falling back to that same label. Only the
// value's own characters change, so comments and layout around it stay as they were.

export type Edit = { readonly from: number; readonly to: number; readonly text: string };
export type WorkflowJobs = { readonly jobs: ReadonlyArray<Omit<CiJob, "workflow">>; readonly edits: ReadonlyArray<Edit> };

// GitHub's own rule for a job's ID.
const JOB_ID = /^[A-Za-z_][\w-]*$/;
const READS_VARIABLE = /^\$\{\{\s*vars\.(LINUX_RUNNER|MAC_RUNNER)\b/;
const HOSTED: ReadonlyArray<readonly [RegExp, RunnerVariable]> = [
  [/^ubuntu-[\w.-]+$/, "LINUX_RUNNER"],
  [/^macos-[\w.-]+$/, "MAC_RUNNER"],
];
const DOCKER_ACTION = /^docker(:\/\/|\/)/;
const DOCKER_COMMAND = /\bdocker(\s+(build|buildx|compose|run)\b|-compose\b)/;
const MAX_SHOWN = 120;

// The repository's own text, shown as one plain line.
const shown = (text: string) => text.replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim().slice(0, MAX_SHOWN);

const dockerOf = (job: YAMLMap): DockerUse | null => {
  if (job.has("services")) return "services";
  if (job.has("container")) return "container";
  const steps = job.get("steps");
  if (!isSeq(steps)) return null;
  let found: DockerUse | null = null;
  for (const step of steps.items) {
    if (!isMap(step)) continue;
    const uses = step.get("uses");
    if (typeof uses === "string" && DOCKER_ACTION.test(uses)) return "action";
    const run = step.get("run");
    if (typeof run === "string" && DOCKER_COMMAND.test(run)) found = "command";
  }
  return found;
};

// Null when the file isn't YAML that GitHub could run.
export function workflowJobs(text: string): WorkflowJobs | null {
  const document = parseDocument(text);
  if (document.errors.length > 0) return null;
  const jobs = document.get("jobs");
  if (!isMap(jobs)) return null;
  const found: Array<Omit<CiJob, "workflow">> = [];
  const edits: Edit[] = [];
  for (const { key, value } of jobs.items) {
    const job = isScalar(key) ? String(key.value) : "";
    // A job that calls a reusable workflow has no `runs-on:`; its runner is that workflow's.
    if (!JOB_ID.test(job) || !isMap(value) || !value.has("runs-on")) continue;
    const node = value.get("runs-on", true);
    const range = node?.range;
    const written = range ? shown(text.slice(range[0], range[1])) : "";
    const docker = dockerOf(value);
    const label = isScalar(node) && typeof node.value === "string" ? node.value : null;
    const reads = label === null ? null : READS_VARIABLE.exec(label);
    if (reads) {
      found.push({ job, runsOn: written, state: "moves", variable: reads[1] === "MAC_RUNNER" ? "MAC_RUNNER" : "LINUX_RUNNER", docker });
      continue;
    }
    const hosted = label === null ? undefined : HOSTED.find(([pattern]) => pattern.test(label));
    // A value written across lines is left alone, so every edit stays on its own line.
    if (hosted === undefined || !range || text.slice(range[0], range[1]).includes("\n")) {
      found.push({ job, runsOn: written, state: "left", variable: null, docker });
      continue;
    }
    const variable = hosted[1];
    found.push({ job, runsOn: written, state: "patched", variable, docker });
    edits.push({ from: range[0], to: range[1], text: `\${{ vars.${variable} || '${label}' }}` });
  }
  return { jobs: found, edits };
}

export const applyEdits = (text: string, edits: ReadonlyArray<Edit>) =>
  edits.toSorted((a, b) => b.from - a.from).reduce((out, edit) => out.slice(0, edit.from) + edit.text + out.slice(edit.to), text);
