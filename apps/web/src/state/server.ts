// A stand-in of runnerbox's, not T3 Code's file: the server keybindings the copied composer checks shortcuts
// against. Runnerbox's server binds none.
import type { ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

const NONE: ResolvedKeybindingsConfig = [];
export const primaryServerKeybindingsAtom = Atom.make(NONE);
