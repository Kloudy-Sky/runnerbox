import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { buildInVm } from "./build-in-vm.ts";
import { hashContext } from "./context-hash.ts";
import { createImageKeeper } from "./image-keeper.ts";

const dir = await mkdtemp(join(tmpdir(), "runnerbox-image-"));
after(() => rm(dir, { recursive: true }));

async function context(name: string, files: Record<string, string>) {
  const root = join(dir, name);
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), contents);
  }
  return root;
}

test("the context hash changes with any file's contents or mode, and only then", async () => {
  const files = { Dockerfile: "FROM runnerbox-base\n", "scripts/setup.sh": "echo hi\n" };
  const a = await context("a", files);
  const b = await context("b", files);
  assert.equal(await hashContext(a), await hashContext(b));

  await writeFile(join(b, "scripts/setup.sh"), "echo changed\n");
  assert.notEqual(await hashContext(a), await hashContext(b));

  const c = await context("c", files);
  await chmod(join(c, "scripts/setup.sh"), 0o755);
  assert.notEqual(await hashContext(a), await hashContext(c));
});

function keeper({ inVm = [] as string[], builds = true, short = null as string | null, removable = true } = {}) {
  const events: string[] = [];
  let hash = "aaaaaaaaaaaa1111";
  const image = createImageKeeper("app", {
    contextHash: async () => hash,
    existsInVm: async (tag) => inVm.includes(tag),
    build: async (tag) => {
      events.push(`build ${tag}`);
      if (builds) inVm.push(tag);
      return builds;
    },
    remove: async (tag) => (events.push(`remove ${tag}`), removable),
    roomForJob: async () => short,
    log: () => {},
  });
  return { image, events, inVm, change: (next: string) => (hash = next) };
}

test("a missing tag is built once, and an existing one is used as is", async () => {
  const fresh = keeper();
  await fresh.image.refresh();
  await fresh.image.refresh();
  assert.equal(fresh.image.current(), "app:aaaaaaaaaaaa");
  assert.deepEqual(fresh.events, ["build app:aaaaaaaaaaaa"]);

  const existing = keeper({ inVm: ["app:aaaaaaaaaaaa"] });
  await existing.image.refresh();
  assert.equal(existing.image.current(), "app:aaaaaaaaaaaa");
  assert.deepEqual(existing.events, []);
});

test("a failed build or short memory keeps the current image", async () => {
  const failing = keeper({ builds: false });
  await failing.image.refresh();
  assert.equal(failing.image.current(), null);

  const short = keeper({ short: "the VM is short" });
  await short.image.refresh();
  assert.equal(short.image.current(), null);
  assert.deepEqual(short.events, []);
});

test("a changed context swaps the tag, and the old one is removed once Docker allows it", async () => {
  const { image, events, change } = keeper({ removable: false });
  await image.refresh();
  change("bbbbbbbbbbbb2222");
  await image.refresh();
  await image.refresh();

  assert.equal(image.current(), "app:bbbbbbbbbbbb");
  assert.deepEqual(events.filter((event) => event.startsWith("remove")), ["remove app:aaaaaaaaaaaa", "remove app:aaaaaaaaaaaa"]);
});

test("the build streams the context to docker build in the VM", async () => {
  const root = await context("streamed", { Dockerfile: "FROM runnerbox-base\n" });
  const ssh = join(dir, "ssh");
  await writeFile(ssh, `#!/bin/bash\nprintf '%s\\n' "$@" > "${ssh}.args"\ncat > "${ssh}.tar"\nexit "\${FAKE_EXIT:-0}"\n`);
  await chmod(ssh, 0o755);
  const vm = { host: "ci@vm", keyFile: "/key", knownHostsFile: "/known" } as const;

  assert.equal(await buildInVm({ vm, context: root, tag: "app:abc", sshBinary: ssh }), true);
  assert.match(await readFile(`${ssh}.args`, "utf8"), /docker build -t 'app:abc' -\n$/);
  assert.match(execFileSync("tar", ["-tf", `${ssh}.tar`], { encoding: "utf8" }), /Dockerfile/);

  process.env.FAKE_EXIT = "1";
  assert.equal(await buildInVm({ vm, context: root, tag: "app:abc", sshBinary: ssh }), false);
  delete process.env.FAKE_EXIT;
});

test("going back to an earlier context never removes the image now in use", async () => {
  const { image, events, change } = keeper({ removable: false });
  await image.refresh();
  change("bbbbbbbbbbbb2222");
  await image.refresh();
  change("aaaaaaaaaaaa1111");
  events.length = 0;
  await image.refresh();
  await image.refresh();

  assert.equal(image.current(), "app:aaaaaaaaaaaa");
  assert.ok(!events.includes("remove app:aaaaaaaaaaaa"));
});

test("a current image that vanished from the VM is rebuilt", async () => {
  const { image, events, inVm } = keeper();
  await image.refresh();
  inVm.length = 0;
  await image.refresh();
  assert.deepEqual(events, ["build app:aaaaaaaaaaaa", "build app:aaaaaaaaaaaa"]);
});
