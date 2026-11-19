import { useAtomValue } from "@effect/atom-react";
import packageJson from "../../package.json" with { type: "json" };
import { isUnderway } from "../lib/serverUpdate.ts";
import { type MachineFacts, planUpdate, type ReleaseFinding, targetVersion } from "../lib/updateEverything.ts";
import { updateFactsAtom } from "../state/serverStatus.ts";
import { useServerUpdates } from "../state/serverUpdates.ts";
import { useDesktopUpdates } from "./useDesktopUpdates.ts";

export const APP_VERSION = packageJson.version;

const errorText = (error: unknown) => (error instanceof Error && error.message ? error.message : "It didn't answer.");

// What the sidebar's Update would do now, across every saved environment. Versions and methods are
// the atoms About and every gated view read. Whether each can update now, and whether the release
// is there for it, is asked only while `asking`, since the release check goes to GitHub.
export function useUpdatePlan(asking: boolean) {
  const desktop = useDesktopUpdates();
  const target = targetVersion(APP_VERSION, desktop?.state ?? null);
  const runs = useServerUpdates((state) => state.runs);
  const facts = useAtomValue(updateFactsAtom({ asking, target }));
  const machines = facts.map(({ environment, connection, about, methodsFailed, capabilities, status, release }): MachineFacts => {
    const releaseFinding: ReleaseFinding | undefined =
      capabilities && !capabilities.checkRelease ? "unchecked" : release?.data ? release.data.signature : release?.isError ? { failed: errorText(release.error) } : undefined;
    return {
      environmentId: environment.environmentId,
      label: environment.label,
      reach: connection === null ? "offline" : connection.route.kind === "connect" ? "connect" : "direct",
      serverVersion: about.data ? about.data.serverVersion : about.isError ? null : undefined,
      canWrite: environment.scopes.includes("access:write"),
      selfUpdates: methodsFailed ? false : capabilities === null ? undefined : capabilities.serverUpdate,
      blocker: status?.data ? status.data.blocker : status?.isError ? null : undefined,
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
