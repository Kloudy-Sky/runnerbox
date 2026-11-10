import type { HostInstall } from "../launcher/launcher-config.ts";

// Where a host install's root-owned files live. The job user can read and run them, and only root
// can change them. The install's name keeps two installs on one machine apart.
export function installPaths({ name }: Pick<HostInstall, "name">) {
  const dir = `/usr/local/libexec/runnerbox/${name}`;
  return {
    dir,
    // The one command `up` may run as root: it runs a job as the job user, then cleans up.
    runJob: `${dir}/run-job`,
    // The runner only runs a hook whose name ends in .sh.
    jobStarted: `${dir}/job-started.sh`,
    pfRules: `${dir}/pf.rules`,
    runnerArchive: `${dir}/actions-runner.tar.gz`,
    sudoers: `/etc/sudoers.d/runnerbox-${name}`,
    // Apple's stock pf.conf evaluates every anchor under com.apple, so this needs no edit to it.
    pfAnchor: `com.apple/runnerbox-${name}`,
  };
}
