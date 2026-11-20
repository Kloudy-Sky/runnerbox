import { Atom } from "effect/reactivity";

// Whether the command palette is open. ⌘K toggles it from anywhere, and every page's bar has a
// button that opens it.
export const commandPaletteOpenAtom = Atom.make(false).pipe(Atom.keepAlive);
