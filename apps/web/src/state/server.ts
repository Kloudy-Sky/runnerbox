// A stand-in of runnerbox's, not T3 Code's file: the server keybindings the copied composer checks shortcuts
// against. Runnerbox's server binds none.
import type { ResolvedKeybindingsConfig } from "@t3tools/contracts";
import type { StandInAtom } from "../t3tools/atom-react.ts";

export const primaryServerKeybindingsAtom: StandInAtom<ResolvedKeybindingsConfig> = { value: [] };
