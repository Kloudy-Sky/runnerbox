import type { UpdateChannel } from "@runnerbox/client-runtime";
import semver from "semver";

// Which feed a channel reads, and what may be installed from it. Releases are versioned so that
// each nightly sorts below the stable it previews (docs/release.md).

const NIGHTLY = /-nightly\.\d{8}\.\d+$/;

// A build follows its own kind until the owner picks otherwise.
export const defaultChannel = (version: string): UpdateChannel => (NIGHTLY.test(version) ? "nightly" : "stable");

// electron-updater's names: `latest-*.yml` for stable, `nightly-*.yml` for nightly.
export const feedOf = (channel: UpdateChannel) => ({ channel: channel === "stable" ? "latest" : "nightly", allowPrerelease: channel === "nightly" }) as const;

// Only ever forward. A nightly user who picks stable keeps their newer nightly until a stable
// passes it, rather than going back to the last stable.
export const isOffered = (current: string, candidate: string) => semver.valid(current) !== null && semver.valid(candidate) !== null && semver.gt(candidate, current);

// The feed's newest is older than what runs: a nightly user who switched to stable, waiting.
export const isAheadOfFeed = (current: string, latest: string | null) => latest !== null && semver.valid(current) !== null && semver.valid(latest) !== null && semver.lt(latest, current);
