// A stand-in of runnerbox's, not T3 Code's file: what the copied sidebar reads from
// `~/hooks/useSettings`. Runnerbox has no client settings, so these are fixed. T3 Code's panels snap
// by default (0 ms); runnerbox's sidebar eases over 200 ms, still snapping under reduced motion.
const CLIENT_SETTINGS = { panelAnimationDurationMs: 200 } as const;

export const useClientSettings = <A>(select: (settings: typeof CLIENT_SETTINGS) => A): A => select(CLIENT_SETTINGS);
