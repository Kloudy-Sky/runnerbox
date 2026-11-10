import assert from "node:assert/strict";
import { test } from "node:test";
import { runJobVm } from "./run-job-vm.ts";

const run = { domain: "box-linux-slot1", pool: "default", disk: "box-linux-slot1.qcow2", golden: "box-golden-1.qcow2", xml: "<domain/>" };

function fakes({ boots = true, failing = "" } = {}) {
  const calls: string[] = [];
  let time = 0;
  return {
    calls,
    actions: {
      virsh: async (args: string[], stdin = "") => {
        calls.push(`${args.join(" ")}${stdin && ` < ${stdin}`}`);
        if (args[0] === failing) throw new Error(`${failing} failed`);
        return args[0] === "vol-info" ? "Name: x\nCapacity:       1024\n" : "";
      },
      answers: async () => {
        if (!boots) throw new Error("connection refused");
      },
      wait: async (ms: number) => void (time += ms),
      now: () => time,
      log: (message: string) => void calls.push(`log ${message}`),
    },
  };
}

const destroyed = ["destroy box-linux-slot1", "vol-delete --pool default box-linux-slot1.qcow2"];

test("a job gets a thin disk over the golden copy, and the VM and disk are gone afterwards", async () => {
  const { actions, calls } = fakes();
  const exitCode = await runJobVm(run, actions, async () => {
    calls.push("job");
    return 7;
  });

  assert.equal(exitCode, 7);
  assert.deepEqual(calls, [
    ...destroyed,
    "vol-info --pool default box-golden-1.qcow2 --bytes",
    "vol-create-as default box-linux-slot1.qcow2 1024 --format qcow2 --backing-vol box-golden-1.qcow2 --backing-vol-format qcow2",
    "create /dev/stdin < <domain/>",
    "job",
    ...destroyed,
  ]);
});

test("the VM is destroyed when the job throws", async () => {
  const { actions, calls } = fakes();
  await assert.rejects(runJobVm(run, actions, async () => Promise.reject(new Error("ssh died"))), /ssh died/);
  assert.deepEqual(calls.slice(-2), destroyed);
});

test("a VM that never answers runs no job, and is destroyed", async () => {
  const { actions, calls } = fakes({ boots: false });
  const exitCode = await runJobVm(run, actions, async () => assert.fail("the job ran"));

  assert.equal(exitCode, null);
  assert.deepEqual(calls.slice(-3), ["log box-linux-slot1: the job VM didn't start: connection refused", ...destroyed]);
});

test("a disk that can't be created boots nothing", async () => {
  const { actions, calls } = fakes({ failing: "vol-create-as" });
  assert.equal(await runJobVm(run, actions, async () => 0), null);
  assert.ok(!calls.some((call) => call.startsWith("create ")));
});
