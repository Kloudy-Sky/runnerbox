import { releaseRepository, ROLLBACK_COMMAND, serverUpdateCommand } from "../lib/serverUpdate.ts";

const REPOSITORY = releaseRepository(import.meta.env.RUNNERBOX_RELEASE_REPO);

const COMMAND = "block select-all break-all rounded-md bg-background px-2 py-1 font-mono text-[12px]";

// The command that updates a server to this app's release, selectable in one click, and the one
// that goes back. A build that doesn't know which repository it came from names no download, so
// it can't point at another's.
export function ServerUpdateCommand({ appVersion }: { appVersion: string }) {
  if (REPOSITORY === null) return <p className="text-muted-foreground">Install runnerbox.js {appVersion} on that machine and restart runnerbox-serve.</p>;
  return (
    <div className="flex flex-col gap-1">
      <code className={COMMAND}>{serverUpdateCommand(REPOSITORY, appVersion)}</code>
      <span className="text-muted-foreground">It keeps the current file as runnerbox.js.previous. To go back to it:</span>
      <code className={COMMAND}>{ROLLBACK_COMMAND}</code>
    </div>
  );
}
