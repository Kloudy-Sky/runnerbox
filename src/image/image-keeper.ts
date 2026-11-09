type ImageActions = {
  contextHash: () => Promise<string>;
  existsInVm: (tag: string) => Promise<boolean>;
  // Builds the context into `tag` in the VM. False when the build fails.
  build: (tag: string) => Promise<boolean>;
  // Removes `tag` from the VM. False when Docker refuses, as it does while a container uses it.
  remove: (tag: string) => Promise<boolean>;
  // Why there's no memory for a build right now, or null when there is.
  roomForJob: () => Promise<string | null>;
  log: (message: string) => void;
};

// Keeps a project's image built in the VM, tagged by its build context's hash. New containers use
// `current`; a running container keeps the image it started with, and older tags are removed once
// nothing uses them.
export function createImageKeeper(name: string, actions: ImageActions) {
  const { contextHash, existsInVm, build, remove, roomForJob, log } = actions;
  let current: string | null = null;
  const stale = new Set<string>();

  async function refresh() {
    const tag = `${name}:${(await contextHash()).slice(0, 12)}`;
    // The current tag is checked too, so an image removed from the VM by any route gets rebuilt.
    const exists = await existsInVm(tag);
    if (tag !== current || !exists) {
      if (!exists) {
        const short = await roomForJob();
        if (short) return log(`image: not building ${tag} yet: ${short}`);
        log(`image: building ${tag}`);
        if (!(await build(tag))) return log(`image: ${tag} failed to build, so new containers keep ${current ?? "nothing"}`);
      }
      if (current && current !== tag) stale.add(current);
      // Going back to an earlier context makes a stale tag current again.
      stale.delete(tag);
      current = tag;
      log(`image: new containers use ${tag}`);
    }
    for (const old of stale) if (await remove(old)) stale.delete(old);
  }

  return { current: () => current, refresh };
}
