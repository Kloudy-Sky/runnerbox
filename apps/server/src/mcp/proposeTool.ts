import * as Context from "effect/Context";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { ChangeValue, Proposal } from "@runnerbox/contracts";
import { MAX_CHANGES } from "../proposals/Proposals.ts";
import { ToolFailure } from "./tools.ts";

// The agent's way to suggest a change to an install's numbers. It only records a proposal: the
// owner sees it in full and decides, and `up` checks it again before anything changes.
export const ProposeToolkit = Toolkit.make(
  Tool.make("propose_change", {
    description: `Records a proposed change to one install's numbers for the owner to approve or decline in the app. Nothing changes unless they approve. Read install_settings first: each path must be one it lists, and each value inside its bounds. Change only what the evidence supports, in one proposal per fix, at most ${MAX_CHANGES} fields. \`reason\` says in one or two plain sentences why, citing the numbers.`,
    parameters: Schema.Struct({
      install: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)),
      changes: Schema.Array(Schema.Struct({ path: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9.]{1,80}$/)), to: ChangeValue })).check(Schema.isMinLength(1), Schema.isMaxLength(MAX_CHANGES)),
      reason: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(600)),
    }),
    success: Proposal,
    failure: ToolFailure,
    failureMode: "return",
  }).annotateMerge(Context.make(Tool.Readonly, false).pipe(Context.add(Tool.Destructive, false))),
);
