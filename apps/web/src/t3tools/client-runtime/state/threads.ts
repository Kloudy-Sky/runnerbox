// A stand-in of runnerbox's, not T3 Code's file: the one type the copied composer logic takes from
// T3 Code's thread state: where an `@` path search would look. Runnerbox has no working tree.
import type { EnvironmentId } from "@t3tools/contracts";

export interface ComposerPathSearchTarget {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly query: string | null;
}
