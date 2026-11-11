import assert from "node:assert/strict";
import { test } from "node:test";
import { createGoldenDisk } from "./golden-disk.ts";
import { createTurns } from "./in-turn.ts";

// A libvirt with one builder, whose Docker holds `tags`.
function fakes({ cloneFails = false } = {}) {
  const calls: string[] = [];
  const volumes = new Set(["builder.qcow2", "box-golden-5.qcow2", "other-golden-5.qcow2"]);
  const world = { state: "running", tags: ["app:aaa"], time: 100_000 };
  const golden = createGoldenDisk(
    { install: "box", domain: "builder", pool: "default" },
    {
      virsh: async (args) => {
        const [command, ...rest] = args;
        if (command !== "domstate" && command !== "vol-list") calls.push(args.join(" "));
        if (command === "domstate") return `${world.state}\n`;
        if (command === "shutdown") world.state = "shut off";
        if (command === "start") world.state = "running";
        if (command === "vol-list") return [" Name  Path", "-----", ...[...volumes].map((name) => ` ${name}  /pool/${name}`)].join("\n");
        if (command === "vol-clone") {
          if (cloneFails) throw new Error("no space left");
          volumes.add(rest.at(-1) ?? "");
        }
        if (command === "vol-delete") volumes.delete(rest.at(-1) ?? "");
        return "";
      },
      inTurn: createTurns(),
      builderTags: async () => {
        if (world.state !== "running") throw new Error("builder is down");
        return `${world.tags.join("\n")}\n`;
      },
      wait: async (ms) => void (world.time += ms),
      now: () => world.time,
      log: () => {},
    },
  );
  return { calls, volumes, world, golden };
}

test("the first hold copies the stopped builder, restarts it, and removes copies an earlier run left", async () => {
  const { golden, calls, volumes } = fakes();
  const held = await golden.hold("app:aaa");

  assert.equal(held.volume, "box-golden-100.qcow2");
  assert.deepEqual(calls, [
    "shutdown builder",
    "vol-clone --pool default builder.qcow2 box-golden-100.qcow2",
    "start builder",
    "vol-delete --pool default box-golden-5.qcow2",
  ]);
  // Another install's copies aren't this one's to delete.
  assert.ok(volumes.has("other-golden-5.qcow2"));
});

test("slots share one copy until an image it lacks is asked for", async () => {
  const { golden, calls, world } = fakes();
  const [first, second] = await Promise.all([golden.hold("app:aaa"), golden.hold()]);
  assert.equal(first.volume, second.volume);
  assert.equal(calls.filter((call) => call.startsWith("vol-clone")).length, 1);

  world.tags.push("app:bbb");
  world.time += 60_000;
  const third = await golden.hold("app:bbb");
  assert.notEqual(third.volume, first.volume);
});

test("a replaced copy is kept while a job VM uses it, then deleted", async () => {
  const { golden, volumes, world } = fakes();
  const first = await golden.hold("app:aaa");
  const alsoFirst = await golden.hold("app:aaa");
  world.tags.push("app:bbb");
  world.time += 60_000;
  await golden.hold("app:bbb");

  await first.release();
  assert.ok(volumes.has(first.volume));
  await alsoFirst.release();
  assert.ok(!volumes.has(first.volume));
});

test("an image the builder doesn't have is refused, not booted without", async () => {
  const { golden } = fakes();
  await assert.rejects(golden.hold("app:missing"), /app:missing isn't in the builder/);
});

test("the builder is started again when its copy fails", async () => {
  const { golden, world } = fakes({ cloneFails: true });
  await assert.rejects(golden.hold(), /no space left/);
  assert.equal(world.state, "running");
});
