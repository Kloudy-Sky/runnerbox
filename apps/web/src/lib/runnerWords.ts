import type { SlotPhase } from "@runnerbox/contracts";

// What a runner is doing, in the words someone new to CI reads: the same on every page that shows
// one machine's runners. `job` is the name its runner said it took, when busy.
export function runnerPhase(phase: SlotPhase, job?: string | null) {
  switch (phase) {
    case "registered":
      return { text: "ready", tone: "text-success" };
    case "busy":
      return { text: job ? `running ${job}` : "running a job", tone: "text-foreground" };
    case "minting":
      return { text: "starting", tone: "text-muted-foreground" };
    case "waiting":
      return { text: "stepped aside for memory", tone: "text-warning" };
    case "backoff":
      return { text: "waiting before it tries again", tone: "text-destructive" };
    case "stopped":
      return { text: "stopped", tone: "text-muted-foreground" };
  }
}
