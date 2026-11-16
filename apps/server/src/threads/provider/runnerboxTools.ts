import { ReviewToolkit } from "../../mcp/reviewTool.ts";
import { RunnerboxToolkit } from "../../mcp/tools.ts";

// The tools a thread's agent may have, from runnerbox's own `/mcp`, whichever CLI runs the turn.
export const SERVER_NAME = "runnerbox";
export const READ_ONLY_TOOL_NAMES = Object.keys(RunnerboxToolkit.tools);
// A turn the owner asked may propose a change; it only records one for the owner to decide.
export const PROPOSE_TOOL_NAME = "propose_change";
// Only in a turn that starts while the owner's reproduce runs.
export const REPRODUCE_TOOL_NAME = "repro_exec";
// A review's turn has these and nothing else.
export const REVIEW_TOOL_NAMES = Object.keys(ReviewToolkit.tools);
export const MAX_AGENT_STEPS = 12;
// Reading a change's callers and what it calls takes many more steps than reading CI history.
export const MAX_REVIEW_STEPS = 150;
// Rerunning a step and narrowing it down takes more steps than reading.
export const MAX_REPRODUCE_STEPS = 30;
