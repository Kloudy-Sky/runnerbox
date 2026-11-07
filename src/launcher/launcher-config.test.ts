import assert from "node:assert/strict";
import { test } from "node:test";
import { type } from "arktype";
import { LauncherConfig, loadLauncherConfig } from "./launcher-config.ts";

const example = () => loadLauncherConfig("runnerbox.example.json");

test("the example config is valid", async () => {
  assert.equal((await example()).name, "example");
});

test("a typo in a limit is rejected, not ignored", async () => {
  const config = await example();
  const result = LauncherConfig({ ...config, limits: { ...config.limits, memmory: "1g" } });
  assert.ok(result instanceof type.errors);
});

test("values that could smuggle in SSH options or shell are rejected", async () => {
  const config = await example();
  for (const bad of [
    { vm: { ...config.vm, host: "-oProxyCommand=evil" } },
    { name: "x; rm -rf /" },
    { image: "x $(evil)" },
    { env: { "A;evil": "1" } },
    { limits: { ...config.limits, memory: "1g --privileged" } },
    { tokenFile: "relative/token" },
    { tokenFile: "/has space/token" },
    { env: { VALUE: "a\0b" } },
    { scope: { repo: "../.." } },
  ]) {
    assert.ok(LauncherConfig({ ...config, ...bad }) instanceof type.errors, JSON.stringify(bad));
  }
});
