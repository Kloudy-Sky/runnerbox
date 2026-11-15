import { useQueries } from "@tanstack/react-query";
import { useStore } from "zustand";
import packageJson from "../../package.json" with { type: "json" };
import { capabilitiesOf } from "../lib/serverCapabilities.ts";
import { isUnderway } from "../lib/serverUpdate.ts";
import { type MachineFacts, planUpdate, type ReleaseFinding, targetVersion } from "../lib/updateEverything.ts";
import { runtime } from "../runtime.ts";
import { useServerUpdates } from "../state/serverUpdates.ts";
import { useDesktopUpdates } from "./useDesktopUpdates.ts";
import { methodsQuery } from "./useServerCapabilities.ts";

export const APP_VERSION = packageJson.version;

const errorText = (error: unknown) => (error instanceof Error && error.message ? error.message : "It didn't answer.");

// What the sidebar's Update would do now, across every saved environment. Versions and methods are
// asked of each connected server as they are elsewhere, under the same keys, so they're shared.
// Whether each can update now, and whether the release is there for it, is asked only while
// `asking`, since the release check goes to GitHub.
export function useUpdatePlan(asking: boolean) {
  const desktop = useDesktopUpdates();
  const target = targetVersion(APP_VERSION, desktop?.state ?? null);
  const environments = useStore(runtime.store, (state) => state.environments);
  const connections = useStore(runtime.store, (state) => state.connections);
  const runs = useServerUpdates((state) => state.runs);
  const live = environments.map(({ environmentId }) => {
    const connection = connections[environmentId];
    return connection?.status === "connected" ? connection : null;
  });

  const about = useQueries({
    queries: environments.map(({ environmentId }, index) => ({
      queryKey: [environmentId, "about"],
      queryFn: () => runtime.run(environmentId, (client) => client["server.about"]()),
      enabled: (live[index] ?? null) !== null,
    })),
  });
  const methods = useQueries({ queries: environments.map(({ environmentId }, index) => methodsQuery(environmentId, live[index]?.since ?? null)) });
  const capabilities = methods.map((query) => (query.isSuccess ? capabilitiesOf(query.data) : null));
  const askable = environments.map((environment, index) => {
    const route = live[index]?.route.kind;
    return asking && target !== null && route !== undefined && route !== "connect" && environment.scopes.includes("access:write") && capabilities[index]?.serverUpdate === true;
  });
  const status = useQueries({
    queries: environments.map(({ environmentId }, index) => ({
      queryKey: [environmentId, "server.updateStatus"],
      queryFn: () => runtime.run(environmentId, (client) => client["server.updateStatus"]()),
      enabled: askable[index] === true,
      // Work that blocks an update starts and stops at any time.
      staleTime: 0,
    })),
  });
  const release = useQueries({
    queries: environments.map(({ environmentId }, index) => ({
      queryKey: [environmentId, "server.checkRelease", target],
      queryFn: () => runtime.run(environmentId, (client) => client["server.checkRelease"]({ version: target ?? "" })),
      enabled: askable[index] === true && capabilities[index]?.checkRelease === true,
    })),
  });

  const machines = environments.map((environment, index): MachineFacts => {
    const connection = live[index] ?? null;
    const versionQuery = about[index];
    const releaseQuery = release[index];
    const statusQuery = status[index];
    const answered = capabilities[index] ?? null;
    const releaseFinding: ReleaseFinding | undefined =
      answered && !answered.checkRelease ? "unchecked" : releaseQuery?.isSuccess ? releaseQuery.data.signature : releaseQuery?.isError ? { failed: errorText(releaseQuery.error) } : undefined;
    return {
      environmentId: environment.environmentId,
      label: environment.label,
      reach: connection === null ? "offline" : connection.route.kind === "connect" ? "connect" : "direct",
      serverVersion: versionQuery?.isSuccess ? versionQuery.data.serverVersion : versionQuery?.isError ? null : undefined,
      canWrite: environment.scopes.includes("access:write"),
      selfUpdates: methods[index]?.isError ? false : answered === null ? undefined : answered.serverUpdate,
      blocker: statusQuery?.isSuccess ? statusQuery.data.blocker : statusQuery?.isError ? null : undefined,
      release: releaseFinding,
      updating: isUnderway(runs[environment.environmentId]),
    };
  });

  const plan = target === null ? null : planUpdate(machines, target);
  const appStatus = desktop?.state.status;
  return {
    target,
    plan,
    // This app restarts last when it has a release coming, which is then the target.
    installsApp: appStatus === "downloading" || appStatus === "ready",
    appReady: appStatus === "ready",
    install: desktop?.actions.install,
  };
}
