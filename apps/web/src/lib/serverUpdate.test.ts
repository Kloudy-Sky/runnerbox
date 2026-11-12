import assert from "node:assert/strict";
import { test } from "node:test";
import { serverIsBehind, serverUpdateCommand } from "./serverUpdate.ts";

test("a server is behind only when it's older than a released app", () => {
  assert.equal(serverIsBehind("0.2.1", "0.2.0"), true);
  assert.equal(serverIsBehind("0.2.1-nightly.20261113.42", "0.2.0"), true);
  assert.equal(serverIsBehind("0.2.1", "0.2.1-nightly.20261113.42"), true);
  assert.equal(serverIsBehind("0.2.1", "0.2.1"), false);
  assert.equal(serverIsBehind("0.2.0", "0.2.1"), false, "a newer server is the app's to catch up with");
  assert.equal(serverIsBehind("0.0.0", "0.0.0"), false, "an app from a checkout can't tell");
});

test("the command fetches this app's own release, checks it and restarts the server", () => {
  assert.equal(
    serverUpdateCommand("0.2.1"),
    "cd ~/runnerbox && curl -fsSL -O https://github.com/Kloudy-Sky/runnerbox/releases/download/v0.2.1/runnerbox.js -O https://github.com/Kloudy-Sky/runnerbox/releases/download/v0.2.1/runnerbox.js.sha256 && sha256sum -c runnerbox.js.sha256 && systemctl --user restart runnerbox-serve",
  );
});
