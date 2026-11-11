import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

// This client's own choices. Nothing here goes to a server.
export const usePreferences = create<{ activeEnvironmentId: string | null; setActive: (id: string | null) => void }>()(
  persist((set) => ({ activeEnvironmentId: null, setActive: (activeEnvironmentId) => set({ activeEnvironmentId }) }), {
    name: "runnerbox.preferences",
    storage: createJSONStorage(() => localStorage),
  }),
);
