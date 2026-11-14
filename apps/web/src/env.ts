// What T3 Code's copied `windowControlsOverlay` reads from `~/env`. The desktop app's preload
// installs `window.runnerbox` before web code runs.
export const isElectron = typeof window !== "undefined" && window.runnerbox !== undefined;
