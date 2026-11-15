import { ActivityIcon, HistoryIcon, type LucideIcon, ServerIcon, SlidersHorizontalIcon, TerminalIcon, WrenchIcon } from "lucide-react";
import type { WorkEntry } from "../../lib/threadTimeline.ts";

// One icon for each kind of thing the agent's tools read, in the place T3 Code shows a tool's icon.
const ICONS: Record<string, LucideIcon> = {
  list_repos: HistoryIcon,
  ci_inbox: HistoryIcon,
  ci_overview: HistoryIcon,
  job_summaries: HistoryIcon,
  step_comparison: HistoryIcon,
  list_runs: HistoryIcon,
  weekly_summary: HistoryIcon,
  launcher_events: ServerIcon,
  runner_state: ServerIcon,
  machine_samples: ActivityIcon,
  install_settings: SlidersHorizontalIcon,
};

export const toolIcon = (entry: WorkEntry): LucideIcon => (entry._tag === "ReproduceCommand" ? TerminalIcon : (ICONS[entry.name] ?? WrenchIcon));
