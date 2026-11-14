import type { ScopedThreadRef } from "@t3tools/contracts";

// What T3 Code's copied toast asks to scope a toast to the open thread. Runnerbox's toasts aren't
// scoped to a thread, so there's never one.
export type ThreadRouteTarget = { kind: "server"; threadRef: ScopedThreadRef } | { kind: "draft"; draftId: string };

export const useThreadRouteTarget = (): ThreadRouteTarget | null => null;
