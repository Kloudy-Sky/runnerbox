import type { ReleaseKey } from "./signature.ts";

// The keys this build trusts to sign releases, from release-keys.json, which scripts/build.ts
// writes in. Empty for a build from a checkout, or before any key was committed: then nothing is
// asked to be signed.
declare const RUNNERBOX_RELEASE_KEYS: ReadonlyArray<ReleaseKey> | undefined;

export const builtInReleaseKeys: ReadonlyArray<ReleaseKey> = typeof RUNNERBOX_RELEASE_KEYS === "object" ? RUNNERBOX_RELEASE_KEYS : [];
