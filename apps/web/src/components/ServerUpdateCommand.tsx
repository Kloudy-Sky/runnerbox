import { serverUpdateCommand } from "../lib/serverUpdate.ts";

// The command that updates a server to this app's release, selectable in one click.
export function ServerUpdateCommand({ appVersion }: { appVersion: string }) {
  return <code className="block select-all break-all rounded-md bg-background px-2 py-1 font-mono text-[12px]">{serverUpdateCommand(appVersion)}</code>;
}
