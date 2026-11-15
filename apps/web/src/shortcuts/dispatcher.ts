// A stand-in of runnerbox's, not T3 Code's file: T3 Code's app-wide command dispatcher, which the copied composer
// asks before it handles a key. Runnerbox registers no commands there.
export const hasCommandForKeyDown = (_event: KeyboardEvent) => false;
