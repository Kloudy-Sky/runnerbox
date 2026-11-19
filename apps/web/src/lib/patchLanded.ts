import type { CiRepo } from "@runnerbox/contracts";

// Whether a repository whose patch was shown now has it on its default branch: a clean read where
// no job is waiting on the patch and some job reads a runner variable. A read that failed or found
// no workflows also comes back without a patch, and isn't a landing.
export const patchLanded = (repo: CiRepo) => repo.patch === null && repo.problem === null && !repo.jobs.some((job) => job.state === "patched") && repo.jobs.some((job) => job.state === "moves");
