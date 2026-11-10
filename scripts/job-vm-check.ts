// Boots real job VMs from a builder that `vm render` made, and checks from inside them what the
// threat model claims: each has its own address, can't reach the host, the builder or another job
// VM, and starts without what an earlier job left behind. CI runs it as root, which libvirt needs:
//   node scripts/job-vm-check.ts <ssh key file> <known_hosts file>
import { startJobVms } from "../src/jobvm/start-job-vms.ts";
import { shellQuote } from "../src/launcher/docker-command.ts";
import { VmInstall } from "../src/launcher/launcher-config.ts";
import { runInVm, type Vm } from "../src/vm/run-in-vm.ts";

const [keyFile, knownHostsFile] = process.argv.slice(2);
const GATEWAY = "192.168.122.1";
const BUILDER = "192.168.122.10";
const ADDRESSES = ["192.168.122.20", "192.168.122.21"] as const;

const config = VmInstall.assert({
  name: "check",
  scope: { repo: "owner/name" },
  tokenFile: "/unused",
  vm: { host: `ci@${BUILDER}`, keyFile, knownHostsFile },
  memoryFloor: { hostMiB: 0, vmMiB: 0 },
  jobVms: { builder: "runnerbox", pool: "default", network: "default", gateway: GATEWAY, addresses: ADDRESSES },
  runners: [
    {
      name: "vm",
      label: "check",
      slots: 2,
      image: "busybox",
      limits: { memory: "512m", memoryReservation: "256m", memorySwap: "1g", cpus: 1, pids: 512, shmSize: "64m" },
      env: {},
      vm: { cpus: 1, memoryMiB: 1536 },
    },
  ],
});
const [runner] = config.runners;
if (!config.jobVms || !runner) throw new Error("the check's own config is wrong");
const jobVms = await startJobVms(config, config.jobVms);

// Fails unless it runs in a VM at `own` that an earlier job never wrote to. The marker is written
// as root through Docker, the way a job that escaped its container could.
const checks = (own: string, other: string) => `
failed=0
check() { if eval "$2" >/dev/null 2>&1; then echo "ok ${own}: $1"; else echo "FAILED ${own}: $1"; failed=1; fi; }
check "has its reserved address" 'ip -4 -o addr | grep -q "inet ${own}/"'
check "GitHub is reachable" 'curl -fsS --max-time 10 https://api.github.com'
check "the gateway is blocked" '! curl -s --max-time 5 -o /dev/null http://${GATEWAY}:8080'
check "the builder is blocked" '! timeout 5 bash -c "</dev/tcp/${BUILDER}/22"'
check "the other job VM is blocked" '! timeout 5 bash -c "</dev/tcp/${other}/22"'
check "nothing is left from an earlier job" '! test -e /left-by-a-job'
check "root in a job can write to the VM's disk" 'docker run --rm -v /:/vm busybox touch /vm/left-by-a-job && test -e /left-by-a-job'
exit $failed
`;

const inVm = (vm: Vm, own: string, other: string) =>
  runInVm({ vm, command: `bash -c ${shellQuote(checks(own, other))}`, secret: "" });

// Both VMs are up before either checks that it can't reach the other.
let arrived = 0;
let bothUp = () => {};
const meeting = new Promise<void>((resolve) => (bothUp = resolve));
const together = async (vm: Vm, own: string, other: string) => {
  if (++arrived === 2) bothUp();
  await meeting;
  return inVm(vm, own, other);
};

const [first, second] = ADDRESSES;
const results = await Promise.all([
  jobVms.run(runner, 1, "busybox", (vm) => together(vm, first, second)),
  jobVms.run(runner, 2, "busybox", (vm) => together(vm, second, first)),
]);
// The same slot again. The first job's marker went with its VM, or this fails.
results.push(await jobVms.run(runner, 1, "busybox", (vm) => inVm(vm, first, second)));

console.log(`job VM checks exited ${results.join(", ")}`);
process.exit(results.every((code) => code === 0) ? 0 : 1);
