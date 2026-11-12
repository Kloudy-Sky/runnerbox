import semver from "semver";

// Which version a release gets, and on which channel. Every release is tagged `v<version>`:
//   stable   X.Y.Z                         from `workflow_dispatch`, a commit a nightly already shipped
//   nightly  X.Y.Z-nightly.YYYYMMDD.<run>  from the schedule, when `main` moved since the last one
// A nightly's X.Y.Z is the stable it previews, so in semver, which electron-updater compares
// with, every nightly sorts below that stable and above the stable before it. Older
// `vX.Y.Z-rc.N` tags fit the same order.

export type Channel = "latest" | "nightly";

const NIGHTLY = /^\d+\.\d+\.\d+-nightly\.\d{8}\.\d+$/;

const versionsOf = (tags: ReadonlyArray<string>) => tags.flatMap((tag) => (tag.startsWith("v") && semver.valid(tag.slice(1)) ? [tag.slice(1)] : []));

// The update feed a build belongs to: electron-updater reads `nightly-*.yml` or `latest-*.yml`.
export const channelOf = (version: string): Channel => (NIGHTLY.test(version) ? "nightly" : "latest");

// The stable the next nightly previews: one patch past the newest stable, or the X.Y.Z an earlier
// prerelease was heading for when that's higher. 0.1.0 before anything was released.
export function nextStable(tags: ReadonlyArray<string>): string {
  const versions = versionsOf(tags);
  const stable = versions.filter((version) => semver.prerelease(version) === null).toSorted(semver.compare).at(-1);
  const candidates = [
    ...(stable ? [semver.inc(stable, "patch")!] : []),
    ...versions.filter((version) => semver.prerelease(version) !== null).map((version) => `${semver.major(version)}.${semver.minor(version)}.${semver.patch(version)}`),
  ].filter((candidate) => !stable || semver.gt(candidate, stable));
  return candidates.toSorted(semver.compare).at(-1) ?? "0.1.0";
}

// `startedAt` is when the run started, so rerunning a run's jobs keeps its version.
export function nightlyVersion(stable: string, startedAt: Date, runNumber: number): string {
  return `${stable}-nightly.${startedAt.toISOString().slice(0, 10).replaceAll("-", "")}.${runNumber}`;
}

export const latestNightlyTag = (tags: ReadonlyArray<string>): string | null => {
  const latest = versionsOf(tags).filter((version) => NIGHTLY.test(version)).toSorted(semver.compare).at(-1);
  return latest ? `v${latest}` : null;
};

export const latestStable = (tags: ReadonlyArray<string>): string | null =>
  versionsOf(tags).filter((version) => semver.prerelease(version) === null).toSorted(semver.compare).at(-1) ?? null;

// The stable a nightly previewed. Promoting it ships the same commit under that plain version.
export function stableOf(nightlyTag: string): string {
  const version = nightlyTag.replace(/^v/, "");
  if (!NIGHTLY.test(version)) throw new Error(`${nightlyTag} isn't a nightly tag.`);
  return `${semver.major(version)}.${semver.minor(version)}.${semver.patch(version)}`;
}
