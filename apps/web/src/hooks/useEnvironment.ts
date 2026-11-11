import { useStore } from "zustand";
import { runtime } from "../runtime.ts";
import { usePreferences } from "../state/preferences.ts";

// The environment this window shows: the one picked last, or the first saved one.
export function useActiveEnvironment() {
  const environments = useStore(runtime.store, (state) => state.environments);
  const activeId = usePreferences((state) => state.activeEnvironmentId);
  const environment = environments.find((saved) => saved.environmentId === activeId) ?? environments[0];
  const connection = useStore(runtime.store, (state) => (environment ? state.connections[environment.environmentId] : undefined));
  return { environment, connection };
}
