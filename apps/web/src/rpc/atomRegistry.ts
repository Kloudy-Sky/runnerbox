// A stand-in of runnerbox's, not T3 Code's file: the registry the copied composer reads atoms from.
import type { StandInAtom } from "../t3tools/atom-react.ts";

export const appAtomRegistry = { get: <A>(atom: StandInAtom<A>): A => atom.value };
