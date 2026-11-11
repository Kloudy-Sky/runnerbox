// What a view shows before `report` has synced any repo on the server's machine.
export const NoHistory = () => (
  <p className="px-3 py-2 text-dim">
    No job history on this machine yet. Run <code className="bg-surf px-1 text-fg">runnerbox report --repo owner/name</code> there to sync one.
  </p>
);
