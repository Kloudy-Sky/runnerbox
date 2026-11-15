// A stand-in of runnerbox's, not T3 Code's package: the two types the copied toast takes from
// `@t3tools/contracts`, which tsconfig and Vite map here. Runnerbox's toasts carry no thread, so
// these only have to type-check.
export type ThreadId = string & { readonly ThreadId: unique symbol };
export type ScopedThreadRef = { readonly environmentId: string; readonly threadId: ThreadId };
