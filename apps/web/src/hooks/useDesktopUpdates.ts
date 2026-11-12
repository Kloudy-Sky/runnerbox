import type { UpdateState } from "@runnerbox/client-runtime";
import { useEffect, useState } from "react";
import { platform } from "../platform.ts";

const updates = platform.updates;

// The desktop app's own updates, live. Null in a browser, which has none.
export function useDesktopUpdates() {
  const [state, setState] = useState<UpdateState | null>(null);
  // Following main's pushes is synchronizing with something outside React.
  useEffect(() => {
    if (!updates) return;
    const unsubscribe = updates.subscribe(setState);
    void updates.state().then(setState);
    return unsubscribe;
  }, []);
  return updates && state ? { state, actions: updates } : null;
}
