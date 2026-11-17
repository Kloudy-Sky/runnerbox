import type { ConnectionState } from "@runnerbox/client-runtime";
import type { InstallExplained } from "@runnerbox/contracts";

type Tone = "bad" | "waiting" | "quiet";

// What's wrong with a machine, if anything: a few words beside its name, and for one that's stopped
// or failing, why in one sentence. Its runners' own reasons come first, in the machine's words.
export function machineTrouble(install: InstallExplained, connection: ConnectionState["status"] | undefined): { note: string; tone: Tone; why: string | null } | null {
  const failing = install.runners.filter((tile) => tile.state === "retrying");
  const aside = install.runners.filter((tile) => tile.state === "stepped_aside");
  if (connection === "disconnected") return { note: "offline, as it last reported", tone: "quiet", why: null };
  if (install.stale) return { note: "not taking jobs", tone: "bad", why: "Runnerbox on it isn't running, or hasn't reported for a while." };
  if (failing.length > 0) {
    const why = failing.find((tile) => tile.why)?.why ?? null;
    return { note: failing.length === install.runners.length ? "failing to start" : `${failing.length} failing to start`, tone: "bad", why };
  }
  if (aside.length > 0) return { note: `${aside.length} stepped aside, low memory`, tone: "waiting", why: null };
  return null;
}
