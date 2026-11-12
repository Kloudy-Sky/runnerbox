// What a view shows before `report` has synced any repo on the server's machine.
export const NoHistory = () => (
  <p className="px-3 py-2 text-muted-foreground">
    No job history on this machine yet. Run <code className="bg-surface px-1 text-foreground">runnerbox report --repo owner/name</code> there to sync one.
  </p>
);
