import { releaseRepository, serverUpdateCommand } from "../lib/serverUpdate.ts";

const REPOSITORY = releaseRepository(import.meta.env.RUNNERBOX_RELEASE_REPO);

// The command that updates a server to this app's release, selectable in one click. A build that
// doesn't know which repository it came from names no download, so it can't point at another's.
export function ServerUpdateCommand({ appVersion }: { appVersion: string }) {
  if (REPOSITORY === null) return <p className="text-muted-foreground">Install runnerbox.js {appVersion} on that machine and restart runnerbox-serve.</p>;
  return <code className="block select-all break-all rounded-md bg-background px-2 py-1 font-mono text-[12px]">{serverUpdateCommand(REPOSITORY, appVersion)}</code>;
}
