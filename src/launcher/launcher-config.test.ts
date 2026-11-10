import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { type } from "arktype";
import { LauncherConfig, loadLauncherConfig } from "./launcher-config.ts";

const dir = await mkdtemp(join(tmpdir(), "runnerbox-config-"));
after(() => rm(dir, { recursive: true }));

async function example() {
  const config = await loadLauncherConfig("runnerbox.example.json");
  if (!("vm" in config)) throw new Error("the example isn't a VM install");
  return config;
}

// The example with its one runner type changed by `patch`.
async function withRunner(patch: object) {
  const config = await example();
  return { ...config, runners: config.runners.map((runner) => ({ ...runner, ...patch })) };
}

test("the example config is valid", async () => {
  assert.equal((await example()).name, "example");
});

test("a typo in a limit is rejected, not ignored", async () => {
  const [runner] = (await example()).runners;
  assert.ok(LauncherConfig(await withRunner({ limits: { ...runner?.limits, memmory: "1g" } })) instanceof type.errors);
});

test("values that could smuggle in SSH options or shell are rejected", async () => {
  const config = await example();
  const [runner] = config.runners;
  for (const bad of [
    { vm: { ...config.vm, host: "-oProxyCommand=evil" } },
    { name: "x; rm -rf /" },
    { tokenFile: "relative/token" },
    { tokenFile: "/has space/token" },
    { scope: { repo: "../.." } },
    { runners: [] },
  ]) {
    assert.ok(LauncherConfig({ ...config, ...bad }) instanceof type.errors, JSON.stringify(bad));
  }
  for (const bad of [
    { name: "linux; evil" },
    // With a `-`, install `ci` kind `rust-gpu` would share container names with install `ci-rust` kind `gpu`.
    { name: "rust-gpu" },
    { image: "x $(evil)" },
    { env: { "A;evil": "1" } },
    { env: { VALUE: "a\0b" } },
    { limits: { ...runner?.limits, memory: "1g --privileged" } },
    { image: { name: "app", context: "relative/dir" } },
    { image: { name: "app; evil", context: "/ci-image" } },
    { image: { name: "app", context: "/ci-image", extra: true } },
  ]) {
    assert.ok(LauncherConfig(await withRunner(bad)) instanceof type.errors, JSON.stringify(bad));
  }
});

test("a runner type's image can be a build context on the host", async () => {
  const result = LauncherConfig(await withRunner({ image: { name: "app-ci", context: "/home/you/ci-image" } }));
  assert.ok(!(result instanceof type.errors));
});

test("two runner types can't share a name or a label", async () => {
  const config = await example();
  const [runner] = config.runners;
  for (const [field, second] of [
    ["name", { ...runner, label: "other" }],
    ["label", { ...runner, name: "other" }],
  ] as const) {
    const path = join(dir, `${field}.json`);
    await writeFile(path, JSON.stringify({ ...config, runners: [runner, second] }));
    await assert.rejects(loadLauncherConfig(path), new RegExp(`two runners have the ${field}`));
  }
});

const hostExample = async () => JSON.parse(await readFile("runnerbox.host.example.json", "utf8"));

test("the host example is valid, and a host install takes no VM settings", async () => {
  const config = await loadLauncherConfig("runnerbox.host.example.json");
  assert.ok("host" in config);
  const { vm } = await example();
  assert.ok(LauncherConfig({ ...(await hostExample()), vm }) instanceof type.errors);
});

test("a host install serves one job at a time, and only safe workflow patterns", async () => {
  const config = await hostExample();
  const [runner] = config.runners;
  for (const bad of [
    { slots: 2 },
    { allowedWorkflows: [] },
    { allowedWorkflows: ["owner/name/.github/workflows/release.yml@refs/tags/v*) exit 0;; x"] },
    { image: "runnerbox-base" },
    { env: { VALUE: "a\nb" } },
  ]) {
    assert.ok(LauncherConfig({ ...config, runners: [{ ...runner, ...bad }] }) instanceof type.errors, JSON.stringify(bad));
  }
  assert.ok(LauncherConfig({ ...config, runners: [runner, { ...runner, name: "other", label: "other" }] }) instanceof type.errors);
  assert.ok(LauncherConfig({ ...config, host: { user: "root; evil" } }) instanceof type.errors);
});
