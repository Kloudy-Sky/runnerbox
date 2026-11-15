// A stand-in of runnerbox's, not T3 Code's file: a path mention's chip label. Runnerbox has no working
// tree, so it's the name alone.
export function FileTagChipContent({ label }: { path: string; environmentId: unknown; cwd: string | undefined; label: string; theme: unknown }) {
  return <span>{label}</span>;
}
