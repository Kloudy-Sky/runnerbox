import type { InstallState, RunnerTile } from "@runnerbox/contracts";
import { listed, plainDuration, plural } from "../../inbox/jobs.ts";

// The page's opening: what the machine is doing and whether that's fine, from parts that each
// appear only when the records show them. It never says nothing is broken, since the records
// can't show that.
export function headline(install: InstallState, runners: readonly RunnerTile[], failing: ReadonlySet<string>, now: number) {
  const count = (state: RunnerTile["state"]) => runners.filter((tile) => tile.state === state).length;
  const running = count("running");
  const aside = count("stepped_aside");
  const ready = count("ready");
  const unsure = count("maybe_running");

  const status = [
    install.stale ? `Runnerbox stopped reporting ${plainDuration(now - Date.parse(install.updatedAt))} ago, so this may be out of date.` : null,
    install.stopping ? "Runnerbox is finishing its jobs and then stopping." : null,
  ];
  const work = running > 0 ? `${plural(running, "job")} running.` : unsure > 0 ? null : "Nothing running.";
  // A kind can take a job now when one of its runners is ready, or may be on an older `up`.
  const open = (kind: InstallState["kinds"][number], states: ReadonlyArray<RunnerTile["state"]>) =>
    runners.some((tile) => tile.kind === kind.name && states.includes(tile.state));
  const withRunners = install.kinds.filter((kind) => runners.some((tile) => tile.kind === kind.name));
  const full = withRunners.filter((kind) => !open(kind, ["ready", "maybe_running"]));
  const taking = withRunners.filter((kind) => open(kind, ["ready"]));
  // "No room" only when no kind could take a job now; otherwise say which wait and which can.
  const room =
    aside === 0 || full.length < withRunners.length ? null : running > 0 ? "No room for another until one finishes." : "Waiting for memory to free up.";
  const waits = full.length > 0 ? `New jobs for ${listed(full.map((kind) => kind.label))} will wait.` : null;
  const can = full.length > 0 && taking.length > 0 ? `${listed(taking.map((kind) => kind.name))} can still take jobs.` : null;
  const failingWords = install.kinds
    .filter((kind) => failing.has(kind.name))
    .map((kind) => `The ${kind.name} runners keep failing before they take a job, so Runnerbox waits before each try.`);
  const images = install.kinds.map((kind) =>
    kind.building
      ? `The ${kind.name} image is rebuilding.`
      : kind.buildFailedAt
        ? kind.image
          ? `The ${kind.name} image's last build failed, so new runners use the previous one.`
          : `The ${kind.name} image's build failed, and there's no earlier one to use.`
        : null,
  );
  const troubles = [room, waits, can, ...failingWords, ...images].filter((part) => part !== null);
  const quiet = troubles.length === 0 && running === 0 && ready > 0 ? `${plural(ready, "runner")} ready.` : null;
  return [...status, work, quiet, ...troubles].filter((part) => part !== null).join(" ");
}
