import { setTimeout as wait } from "node:timers/promises";
import { containerName } from "../launcher/docker-command.ts";
import type { RunnerType, VmInstall } from "../launcher/launcher-config.ts";
import { readFromVm, type Vm } from "../vm/run-in-vm.ts";
import { createGoldenDisk } from "./golden-disk.ts";
import { createTurns } from "./in-turn.ts";
import { ensureJobNetwork } from "./job-network.ts";
import { jobVmXml } from "./job-vm-xml.ts";
import { runJobVm } from "./run-job-vm.ts";
import { virsh } from "./virsh.ts";

// Sets up an install whose jobs each run in their own VM. `inBuilder` gives a task the builder to
// itself, and `run` boots one slot's VM, hands `job` the way in, and destroys the VM afterwards.
export async function startJobVms(config: VmInstall, jobVms: NonNullable<VmInstall["jobVms"]>) {
  const { name: install, vm: builder, runners } = config;
  const { pool, network, addresses } = jobVms;
  const filter = await ensureJobNetwork({ install, ...jobVms }, virsh);
  const inBuilder = createTurns();
  const clock = { wait: async (ms: number) => void (await wait(ms)), now: Date.now, log: console.log };
  const golden = createGoldenDisk(
    { install, domain: jobVms.builder, pool },
    {
      virsh,
      inTurn: inBuilder,
      builderTags: () => readFromVm({ vm: builder, command: "docker image ls --format '{{.Repository}}:{{.Tag}}'" }),
      ...clock,
    },
  );

  // Kinds take addresses in config order, a slot each.
  const firstAddress = runners.map((_, index) => runners.slice(0, index).reduce((sum, runner) => sum + runner.slots, 0));

  async function run(runner: RunnerType, slot: number, image: string, job: (vm: Vm) => Promise<number | null>) {
    const address = addresses[(firstAddress[runners.indexOf(runner)] ?? 0) + slot - 1];
    if (!runner.vm || !address) throw new Error(`${runner.name} slot ${slot} has no VM size or address`);
    const domain = containerName(install, runner.name, slot);
    const disk = `${domain}.qcow2`;
    const [user, builderAddress = ""] = builder.host.split("@");
    const vm: Vm = { ...builder, host: `${user}@${address}`, hostKeyAlias: builderAddress };

    // Only an image built from a context has to be in the copy. Docker pulls any other.
    const held = await golden.hold(typeof runner.image === "string" ? undefined : image).catch((error: unknown) => {
      console.log(`${domain}: ${error instanceof Error ? error.message : error}`);
      return null;
    });
    if (!held) return null;
    try {
      return await runJobVm(
        {
          domain,
          pool,
          disk,
          golden: held.volume,
          xml: jobVmXml({ domain, ...runner.vm, pool, disk, seed: `${jobVms.builder}-seed.iso`, network, address, filter }),
        },
        {
          virsh,
          // Sysbox starts after Docker, and a job that beats it fails at once.
          answers: () => readFromVm({ vm, command: `docker info >/dev/null${runner.docker ? " && systemctl is-active --quiet sysbox" : ""}` }),
          ...clock,
        },
        () => job(vm),
      );
    } finally {
      await held.release();
    }
  }

  return { inBuilder, run };
}
