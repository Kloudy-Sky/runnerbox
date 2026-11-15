// A stand-in of runnerbox's, not T3 Code's file: T3 Code's thread store, which the copied paste handling asks for a
// pasted thread link's title. Runnerbox's threads aren't in such a store, so a link keeps its text.
import type { ScopedThreadRef } from "@t3tools/contracts";

export const readThreadShell = (_ref: ScopedThreadRef): { readonly title: string } | null => null;
