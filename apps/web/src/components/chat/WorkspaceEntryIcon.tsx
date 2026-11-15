// A stand-in of runnerbox's, not T3 Code's file: a path mention's tooltip. Runnerbox has no
// working tree to describe the path from.
export function WorkspaceEntryTooltip({ path }: { path: string; environmentId: unknown; cwd: string | undefined }) {
  return <span>{path}</span>;
}
