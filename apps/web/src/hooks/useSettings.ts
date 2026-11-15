// A stand-in of runnerbox's, not T3 Code's file: what the copied sidebar reads from
// `~/hooks/useSettings`. Runnerbox has no client settings for it, so it gets T3 Code's defaults.
const CLIENT_SETTINGS = { panelAnimationDurationMs: 0 } as const;

export const useClientSettings = <A>(select: (settings: typeof CLIENT_SETTINGS) => A): A => select(CLIENT_SETTINGS);
