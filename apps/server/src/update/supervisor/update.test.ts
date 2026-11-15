import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type Behaviour, standIn } from "./testing/standIn.ts";
import { type UpdateStep } from "./Supervisor.ts";
import { type ReleaseKey, releaseMessage } from "./signature.ts";
import { readRecord, updatePaths } from "./updateFiles.ts";

const HARNESS = new URL("./testing/harness.ts", import.meta.url).pathname;
const OLD = "0.3.1";
const NEW = "0.3.2";

type Install = { readonly dir: string; readonly file: string };

// A runnerbox.js on the old version, in a directory of its own.
async function withInstall(body: (install: Install) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "runnerbox-update-"));
  const file = join(dir, "runnerbox.js");
  await writeFile(file, standIn(OLD), { mode: 0o755 });
  try {
    await body({ dir, file });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

// What the server does before asking: download the release into staging and check it.
async function stage({ file }: Install, version: string, behaviour: Behaviour = "good") {
  const source = standIn(version, behaviour);
  const path = updatePaths(file).staged(version);
  await mkdir(updatePaths(file).dir, { recursive: true, mode: 0o700 });
  await writeFile(path, source, { mode: 0o600 });
  return { version, path, sha256: sha256(source) };
}

type Started = { readonly child: ChildProcess; readonly exited: Promise<number | null> };

// The supervisor as its own process group, as a service manager runs it, so killing the group
// kills the supervisor and its servers together, as systemd does when the supervisor dies.
function supervise({ file }: Install, pauseAt: UpdateStep | "-" = "-", env: NodeJS.ProcessEnv = {}): Started {
  const child = spawn(process.execPath, [HARNESS, file, pauseAt, "serve"], { env: { ...process.env, ...env }, stdio: ["ignore", "inherit", "pipe"], detached: true });
  child.stderr?.resume();
  return { child, exited: new Promise((resolve) => child.once("exit", (code) => resolve(code))) };
}

const killGroup = (started: Started) => {
  try {
    process.kill(-(started.child.pid ?? 0), "SIGKILL");
  } catch {
    // Already gone.
  }
  return started.exited;
};

async function until<T>(what: string, probe: () => Promise<T | null | undefined | false>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const log = async ({ dir }: Install) => (await readFile(join(dir, "events.log"), "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
// Each server's starts and stops, in order.
const events = async (install: Install) => (await log(install)).filter((line) => !line.startsWith("ready "));
// Once a server has said it's ready, which is when it can ask for an update.
// Once a server has said it's ready, which is when it can ask for an update; the `times`th time
// that version has, counting from the install's first start.
const serving = (install: Install, version: string, role = "active", times = 1) =>
  until(`${version} to be ready as ${role}`, async () => (await log(install)).filter((line) => line === `ready ${version} ${role}`).length >= times);
const started = (install: Install, version: string, role: string) => until(`${version} to start as ${role}`, async () => (await events(install)).includes(`start ${version} ${role}`));
// Written whole, then renamed, so the stand-in never reads half of it.
const ask = async ({ dir }: Install, ...requests: ReadonlyArray<{ version: string; path: string; sha256: string; signature?: string | null }>) => {
  await writeFile(join(dir, "request.tmp"), JSON.stringify(requests));
  await rename(join(dir, "request.tmp"), join(dir, "request.json"));
};
// The supervisor's answers so far, once there are `count` of them.
const replies = ({ dir }: Install, count: number) =>
  until(`${count} replies`, async () => {
    const lines = (await readFile(join(dir, "replies.ndjson"), "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
    return lines.length >= count ? lines.map((line) => JSON.parse(line)) : null;
  });
const reply = async (install: Install, nth = 1) => (await replies(install, nth))[nth - 1];
const record = ({ file }: Install) => readRecord(updatePaths(file).record);
const settled = (install: Install) => until("the update to settle", async () => {
  const current = await record(install);
  return current?.status === "pending" ? null : current;
});
const stepReached = ({ dir }: Install, step: UpdateStep) => until(`step ${step}`, async () => existsSync(join(dir, `step-${step}`)));

test("an update puts the new version in place once it's ready, and keeps the old one beside it", async () => {
  await withInstall(async (install) => {
    const started = supervise(install);
    try {
      await serving(install, OLD);
      const staged = await stage(install, NEW);
      await ask(install, staged);
      assert.equal((await reply(install)).type, "update-accepted");
      const done = await settled(install);
      assert.equal(done?.status, "committed");
      assert.equal(done?.from, OLD);
      assert.equal(done?.to, NEW);
      assert.equal(sha256(await readFile(install.file, "utf8")), staged.sha256);
      assert.equal(await readFile(updatePaths(install.file).previous, "utf8"), standIn(OLD));
      assert.deepEqual(await events(install), [`start ${OLD} active`, `stop ${OLD}`, `start ${NEW} trial`]);
      // runnerbox.js keeps the mode it had, not the download's.
      const { stat } = await import("node:fs/promises");
      assert.equal((await stat(install.file)).mode & 0o777, 0o755);
    } finally {
      await killGroup(started);
    }
  });
});

for (const [behaviour, why] of [
  ["crash", /stopped with code 1 before it was ready\. Its last error: Error: the state directory is unreadable/],
  ["never-ready", /wasn't ready within 1 seconds/],
  ["wrong-version", /said it was version 9\.9\.9/],
] as const) {
  test(`a new version that fails its trial (${behaviour}) is dropped and the old one runs again`, async () => {
    await withInstall(async (install) => {
      const started = supervise(install, "-", { TRIAL_TIMEOUT_MS: "1000" });
      try {
        await serving(install, OLD);
        await ask(install, await stage(install, NEW, behaviour));
        assert.equal((await reply(install)).type, "update-accepted");
        const done = await settled(install);
        assert.equal(done?.status, "rolled-back");
        assert.match(done?.reason ?? "", why);
        assert.equal(await readFile(install.file, "utf8"), standIn(OLD));
        await until("the old version to start again", async () => (await events(install)).filter((line) => line === `start ${OLD} active`).length === 2);
        assert.ok(!existsSync(updatePaths(install.file).staged(NEW)), "the download is gone");
      } finally {
        await killGroup(started);
      }
    });
  });
}

for (const [behaviour, why] of [
  ["wont-run", /won't run on this machine\. SyntaxError: this needs Node 99/],
  ["version-hangs", /won't run on this machine\. Asking its version didn't finish/],
] as const) {
  test(`a download that won't run here (${behaviour}) is refused while the old server keeps serving`, async () => {
    await withInstall(async (install) => {
      const started = supervise(install);
      try {
        await serving(install, OLD);
        await ask(install, await stage(install, NEW, behaviour));
        const answer = await reply(install);
        assert.equal(answer.type, "update-refused");
        assert.match(answer.reason, why);
        assert.equal(await record(install), null, "nothing was recorded");
        assert.deepEqual(await events(install), [`start ${OLD} active`], "the old server never stopped");
      } finally {
        await killGroup(started);
      }
    });
  });
}

test("a downgrade, a version that isn't a release and a file outside staging are refused", async () => {
  await withInstall(async (install) => {
    const started = supervise(install);
    try {
      await serving(install, OLD);
      const older = await stage(install, "0.3.0");
      let asked = 0;
      for (const [request, why] of [
        [older, /isn't newer than 0\.3\.1, and an update never goes back/],
        [{ ...older, version: OLD }, /isn't newer/],
        [{ ...older, version: "latest" }, /isn't a release version/],
        [{ ...(await stage(install, NEW)), path: install.file }, /isn't where updates are kept/],
        [{ ...(await stage(install, NEW)), sha256: "0".repeat(64) }, /changed after it was checked/],
      ] as const) {
        await ask(install, request);
        const answer = await reply(install, ++asked);
        assert.equal(answer.type, "update-refused");
        assert.match(answer.reason, why);
      }
      assert.equal(await record(install), null);
      assert.deepEqual(await events(install), [`start ${OLD} active`]);
    } finally {
      await killGroup(started);
    }
  });
});

test("of two updates asked at once, the second is refused and the first goes through", async () => {
  await withInstall(async (install) => {
    const started = supervise(install);
    try {
      await serving(install, OLD);
      const staged = await stage(install, NEW);
      await ask(install, staged, staged);
      // The refusal comes first, while the first request is still being checked.
      const [refused, accepted] = await replies(install, 2);
      assert.equal(refused.type, "update-refused");
      assert.match(refused.reason, /already running/);
      assert.equal(accepted.type, "update-accepted");
      assert.equal((await settled(install))?.status, "committed");
    } finally {
      await killGroup(started);
    }
  });
});

// Killed at each step, as by a crash or a power cut: the next start settles the record by what's
// on disk, and runs whichever file is there.
for (const [step, outcome, runs] of [
  ["accepted", "rolled-back", OLD],
  ["old-stopped", "rolled-back", OLD],
  ["trial-started", "rolled-back", OLD],
  ["previous-kept", "rolled-back", OLD],
  ["renamed", "committed", NEW],
] as const) {
  test(`a supervisor killed at "${step}" comes back on ${runs === NEW ? "the new" : "the old"} version`, async () => {
    await withInstall(async (install) => {
      const first = supervise(install, step);
      let second: Started | null = null;
      try {
        await serving(install, OLD);
        const staged = await stage(install, NEW);
        await ask(install, staged);
        await stepReached(install, step);
        assert.equal((await record(install))?.status, "pending");
        await killGroup(first);
        second = supervise(install);
        await serving(install, runs, "active", runs === OLD ? 2 : 1);
        const done = await record(install);
        assert.equal(done?.status, outcome);
        if (outcome === "rolled-back") assert.match(done?.reason ?? "", /stopped in the middle of the update/);
        assert.equal(sha256(await readFile(install.file, "utf8")), runs === NEW ? staged.sha256 : sha256(standIn(OLD)));
        assert.ok(!existsSync(updatePaths(install.file).staged(NEW)), "no download is left behind");
      } finally {
        await killGroup(first);
        if (second) await killGroup(second);
      }
    });
  });
}

test("a stop during the trial leaves the old version and records why", async () => {
  await withInstall(async (install) => {
    const supervisor = supervise(install, "-", { TRIAL_TIMEOUT_MS: "10000" });
    try {
      await serving(install, OLD);
      await ask(install, await stage(install, NEW, "never-ready"));
      await started(install, NEW, "trial");
      supervisor.child.kill("SIGTERM");
      assert.equal(await supervisor.exited, 0);
      const done = await record(install);
      assert.equal(done?.status, "rolled-back");
      assert.equal(done?.reason, "The service was stopped during the update.");
      assert.equal(await readFile(install.file, "utf8"), standIn(OLD));
    } finally {
      await killGroup(supervisor);
    }
  });
});

test("a failure to put the new file in place, such as a full disk, keeps the old version", async () => {
  await withInstall(async (install) => {
    // Where the old file's copy goes, a directory, so the copy fails as a write to a full disk would.
    await mkdir(updatePaths(install.file).previous);
    const started = supervise(install);
    try {
      await serving(install, OLD);
      await ask(install, await stage(install, NEW));
      const done = await settled(install);
      assert.equal(done?.status, "rolled-back");
      assert.match(done?.reason ?? "", /couldn't be put in place/);
      assert.equal(await readFile(install.file, "utf8"), standIn(OLD));
      await until("the old version to start again", async () => (await events(install)).filter((line) => line === `start ${OLD} active`).length === 2);
    } finally {
      await killGroup(started);
    }
  });
});

// A throwaway signing key, made for the test.
const throwawayKey = (id: string) => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const key: ReleaseKey = { id, publicKey: publicKey.export({ type: "spki", format: "pem" }).toString() };
  return { key, sign: (version: string, checksum: string) => sign(null, Buffer.from(releaseMessage(version, checksum)), privateKey).toString("base64") };
};

test("a supervisor that trusts a key installs a release signed by it", async () => {
  const signer = throwawayKey("current");
  await withInstall(async (install) => {
    const started = supervise(install, "-", { TEST_RELEASE_KEYS: JSON.stringify([signer.key]) });
    try {
      await serving(install, OLD);
      const staged = await stage(install, NEW);
      await ask(install, { ...staged, signature: signer.sign(NEW, staged.sha256) });
      assert.equal((await settled(install))?.status, "committed");
    } finally {
      await killGroup(started);
    }
  });
});

// The server checks first, but the supervisor decides what runs, so it checks again on its own.
test("a supervisor that trusts a key refuses a release a server sends it unsigned or wrongly signed", async () => {
  const [signer, stranger] = [throwawayKey("current"), throwawayKey("stranger")];
  await withInstall(async (install) => {
    const started = supervise(install, "-", { TEST_RELEASE_KEYS: JSON.stringify([signer.key]) });
    try {
      await serving(install, OLD);
      const staged = await stage(install, NEW);
      const requests = [
        { ...staged, signature: null },
        { ...staged },
        { ...staged, signature: stranger.sign(NEW, staged.sha256) },
        { ...staged, signature: signer.sign("0.3.3", staged.sha256) },
        { ...staged, signature: signer.sign(NEW, "0".repeat(64)) },
        { ...staged, signature: "not a signature" },
      ];
      for (const [index, request] of requests.entries()) {
        await ask(install, request);
        const answer = await reply(install, index + 1);
        assert.equal(answer.type, "update-refused", `request ${index}`);
        assert.match(answer.reason, /isn't signed with a key this version trusts/);
      }
      assert.equal(await record(install), null);
      assert.deepEqual(await events(install), [`start ${OLD} active`], "the old server never stopped");
    } finally {
      await killGroup(started);
    }
  });
});
