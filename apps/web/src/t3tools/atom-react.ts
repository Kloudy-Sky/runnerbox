// A stand-in of runnerbox's, not T3 Code's file: what the copied composer reads from `@effect/atom-react`, which
// tsconfig and Vite map here. T3 Code's atoms follow its server; runnerbox's stand-in atoms only
// ever hold one value, so reading one is reading that value. runnerbox is on Effect 4.1 now, as the
// real package needs, so it replaces this once the client's state moves to atoms.
export type StandInAtom<A> = { readonly value: A };

export const useAtomValue = <A>(atom: StandInAtom<A>): A => atom.value;
