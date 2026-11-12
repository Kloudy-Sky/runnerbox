// Decides what one run of the release workflow ships, and writes it to $GITHUB_OUTPUT:
//   node scripts/release-plan.ts
// It reads the event from the environment GitHub sets, and tags and commits from the checkout,
// which needs every tag fetched.
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import semver from "semver";
import { latestStable, nextStable, nightlyTagsNewestFirst, nightlyVersion, stableOf } from "./release-version.ts";

export type Plan =
  // `cli` is a pushed `v*` tag: `runnerbox.js` only, as before nightly and stable existed.
  | { readonly mode: "cli" | "nightly" | "stable"; readonly tag: string; readonly version: string; readonly sha: string }
  | { readonly mode: "skip"; readonly reason: string };

export type PlanInput = {
  readonly event: string;
  readonly refName: string;
  readonly sha: string;
  readonly runNumber: number;
  readonly runStartedAt: Date;
  // The nightly to promote, when the stable dispatch names one; the latest otherwise.
  readonly promote: string;
  readonly tags: ReadonlyArray<string>;
  readonly commitOf: (tag: string) => string;
  // Whether this workflow published the tag's nightly, from a commit on `main`. Anyone who can
  // push a tag can make one that looks like a nightly; only these count.
  readonly shippedNightly: (tag: string) => boolean;
};

const latestShipped = (input: PlanInput) => nightlyTagsNewestFirst(input.tags).find(input.shippedNightly) ?? null;

export function planRelease(input: PlanInput): Plan {
  switch (input.event) {
    case "push":
      return { mode: "cli", tag: input.refName, version: input.refName.replace(/^v/, ""), sha: input.sha };
    case "schedule": {
      const last = latestShipped(input);
      if (last && input.commitOf(last) === input.sha) return { mode: "skip", reason: `main hasn't changed since ${last}.` };
      const version = nightlyVersion(nextStable(input.tags), input.runStartedAt, input.runNumber);
      return { mode: "nightly", tag: `v${version}`, version, sha: input.sha };
    }
    case "workflow_dispatch": {
      if (input.refName !== "main") throw new Error(`Stable releases are dispatched from main, not ${input.refName}.`);
      const nightly = input.promote === "" ? latestShipped(input) : input.promote;
      if (!nightly) throw new Error("There's no nightly to promote yet. A stable release ships a commit a nightly already shipped.");
      if (!input.tags.includes(nightly)) throw new Error(`${nightly} isn't a tag in this repository.`);
      const version = stableOf(nightly);
      if (!input.shippedNightly(nightly)) throw new Error(`${nightly} isn't a nightly this workflow published from main, so it can't become stable.`);
      if (input.tags.includes(`v${version}`)) throw new Error(`v${version} is already released.`);
      const stable = latestStable(input.tags);
      if (stable && !semver.gt(version, stable)) throw new Error(`${nightly} previews ${version}, which isn't newer than the latest stable, ${stable}.`);
      return { mode: "stable", tag: `v${version}`, version, sha: input.commitOf(nightly) };
    }
    default:
      throw new Error(`The release workflow doesn't run on ${input.event}.`);
  }
}

if (import.meta.main) {
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
  const succeeds = (command: string, args: string[]) => spawnSync(command, args, { stdio: "ignore" }).status === 0;
  const onMain = (sha: string) => succeeds("git", ["merge-base", "--is-ancestor", sha, "HEAD"]);
  // A published release this workflow's GITHUB_TOKEN made, not a draft or someone's own.
  const publishedByWorkflow = (tag: string) =>
    spawnSync("gh", ["release", "view", tag, "--repo", process.env.GITHUB_REPOSITORY ?? "", "--json", "isDraft,author", "--jq", '(.isDraft | not) and .author.login == "github-actions[bot]"'], { encoding: "utf8" }).stdout.trim() === "true";
  const env = (name: string) => process.env[name] ?? "";
  const plan = planRelease({
    event: env("GITHUB_EVENT_NAME"),
    refName: env("GITHUB_REF_NAME"),
    sha: env("GITHUB_SHA"),
    runNumber: Number(env("GITHUB_RUN_NUMBER")),
    runStartedAt: new Date(env("RUN_STARTED_AT")),
    promote: env("PROMOTE"),
    tags: git("tag", "--list", "v*").split("\n").filter(Boolean),
    commitOf: (tag) => git("rev-list", "-n", "1", tag),
    // Scheduled and stable runs check out main, so HEAD is main.
    shippedNightly: (tag) => onMain(git("rev-list", "-n", "1", tag)) && publishedByWorkflow(tag),
  });
  const lines = Object.entries(plan).map(([key, value]) => `${key}=${value}`);
  console.log(lines.join("\n"));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
}
