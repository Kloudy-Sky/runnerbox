import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Stream from "effect/Stream";
import * as ServerPaths from "../../config/ServerPaths.ts";
import { makeWith } from "./CodexAdapter.ts";
import type { TurnInput } from "./ProviderAdapter.ts";

const FAKE = fileURLToPath(new URL("../../testing/fakeCodex.ts", import.meta.url));
const TOKEN = "turn-token-example";
const KEY = "sk-proj-example-0000000000-e5f6";

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const settle = async (pids: ReadonlyArray<number>) => {
  for (let tries = 0; tries < 40 && pids.some(alive); tries++) await new Promise((resolve) => setTimeout(resolve, 100));
  return pids.filter(alive);
};

// One turn against the fake `codex`, playing `scenario`, as an account that still holds a key from
// before Codex refused them, which must not reach Codex.
async function turn(
  scenario: string,
  options: { readonly version?: string; readonly ownerHome?: boolean; readonly ownerServers?: ReadonlyArray<{ name: string; enabled: boolean }>; readonly mcpStatus?: ReadonlyArray<unknown> } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), "runnerbox-codex-test-"));
  const logPath = join(dir, "fake-codex.log");
  await writeFile(join(dir, "fake-codex.json"), JSON.stringify({ scenario, version: options.version ?? "0.167.2", ownerServers: options.ownerServers, mcpStatus: options.mcpStatus }));
  // Inside `.server`, so the fake finds its settings from this home too.
  const ownerHome = join(dir, ".server", "owner-codex-home");
  if (options.ownerHome) await mkdir(ownerHome, { recursive: true });
  const input: TurnInput = {
    systemPrompt: "Example system prompt.",
    prompt: "Why did ci / test fail?",
    images: [],
    mcp: { url: "http://127.0.0.1:1/mcp", token: TOKEN },
    reproduce: false,
    propose: true,
    account: { label: "Codex, API", model: "gpt-6-luna", apiKey: KEY, home: options.ownerHome ? ownerHome : null },
  };
  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const adapter = yield* makeWith(() => FAKE);
      return yield* Stream.runCollect(adapter.runTurn(input));
    }).pipe(Effect.provide(ServerPaths.layer(dir))),
  );
  const log = (await readFile(logPath, "utf8").catch(() => ""))
    .split("\n")
    .filter(Boolean)
    .map((line): Record<string, unknown> => JSON.parse(line));
  const pids = (log.find((entry) => entry.pids)?.pids as number[] | undefined) ?? [];
  // Read once Codex and its children are gone, so a home it wrote into on the way out shows.
  const left = await settle(pids);
  return { exit, log, left, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
const stoppedWith = (exit: Exit.Exit<unknown, { readonly message: string }>) => (Exit.isFailure(exit) ? String(exit.cause) : "");

test("a turn on Runnerbox's tools streams its text, its token reaches codex only in its environment, and no key does", async () => {
  const run = await turn("answer");
  try {
    assert.ok(Exit.isSuccess(run.exit), stoppedWith(run.exit));
    const events = Exit.isSuccess(run.exit) ? [...run.exit.value] : [];
    assert.deepEqual(events.map((event) => event._tag), ["ToolCall", "TextDelta", "Text", "Done"]);
    const env = run.log.find((entry) => entry.env)?.env as { token: string; key: string; home: string };
    assert.equal(env.token, TOKEN);
    assert.equal(env.key, null, "Codex runs on Runnerbox's sign-in, never a key");
    assert.match(env.home, /\.server\/agent\/codex-home$/);
    assert.deepEqual(run.left, [], "codex and what it started are gone");
  } finally {
    await run.cleanup();
  }
});

test("a patch Codex asks to apply is declined before it runs, and the turn ends with nothing left running", async () => {
  const run = await turn("patch");
  try {
    assert.match(stoppedWith(run.exit), /asked to apply a patch.*declined before it ran/);
    assert.deepEqual(
      run.log.find((entry) => entry.received === "response:100"),
      { received: "response:100", result: { decision: "denied" } },
    );
    assert.ok(!run.log.some((entry) => entry.executed), "the patch never ran");
    assert.deepEqual(run.left, [], "codex and what it started are gone");
  } finally {
    await run.cleanup();
  }
});

test("a subagent, or a message this version doesn't know, ends the turn", async () => {
  for (const [scenario, said] of [
    ["subagent", /started a `collabAgentToolCall` item/],
    ["unknown", /`thread\/somethingNew`/],
  ] as const) {
    const run = await turn(scenario);
    try {
      assert.match(stoppedWith(run.exit), said);
      assert.deepEqual(run.left, [], `${scenario}: codex and what it started are gone`);
    } finally {
      await run.cleanup();
    }
  }
});

test("Codex saying it applied a wider sandbox stops the turn before the question is sent", async () => {
  const run = await turn("wide-sandbox");
  try {
    assert.match(stoppedWith(run.exit), /didn't send the question.*sandbox isn't read-only/);
    assert.ok(!run.log.some((entry) => entry.received === "turn/start"));
  } finally {
    await run.cleanup();
  }
});

test("a Codex release the adapter wasn't checked against runs no turn, and says which it needs", async () => {
  const run = await turn("answer", { version: "0.168.0" });
  try {
    assert.match(stoppedWith(run.exit), /Runnerbox runs Codex 0\.167\.2 or a later 0\.167 release; this machine has codex-cli 0\.168\.0/);
    assert.ok(!run.log.some((entry) => entry.received), "app-server never started");
  } finally {
    await run.cleanup();
  }
});

test("on the owner's Codex login, Codex runs from their home with their MCP servers, notify and developer instructions off", async () => {
  const run = await turn("answer", { ownerHome: true, ownerServers: [{ name: "docs", enabled: true }, { name: "team.tools", enabled: true }, { name: "old", enabled: false }] });
  try {
    assert.ok(Exit.isSuccess(run.exit), stoppedWith(run.exit));
    const env = run.log.find((entry) => entry.env)?.env as { home: string };
    assert.match(env.home, /owner-codex-home$/);
    const spawned = run.log.find((entry) => entry.spawned)?.spawned as string[];
    const settings = spawned.flatMap((arg, index) => (spawned[index - 1] === "-c" ? [arg] : []));
    assert.ok(settings.includes('mcp_servers={"docs"={enabled=false},"team.tools"={enabled=false}}'));
    assert.ok(settings.includes("mcp_servers.docs.enabled=false"));
    assert.ok(settings.includes("notify=[]"));
    assert.ok(settings.includes('developer_instructions=""'));
    assert.ok(settings.indexOf('mcp_servers={"docs"={enabled=false},"team.tools"={enabled=false}}') < settings.findIndex((setting) => setting.startsWith("mcp_servers.runnerbox.")), "the table comes before Runnerbox's own server");
  } finally {
    await run.cleanup();
  }
});

test("a turn on the owner's login stops before the question if Codex says one of their MCP servers is still on", async () => {
  const run = await turn("answer", {
    ownerHome: true,
    ownerServers: [{ name: "docs", enabled: true }],
    mcpStatus: [
      { name: "runnerbox", runtimeStatus: "ready", tools: { ci_overview: {} } },
      { name: "docs", runtimeStatus: "ready", tools: { search: {} } },
    ],
  });
  try {
    assert.match(stoppedWith(run.exit), /didn't send the question.*MCP server `docs` is on/);
    assert.ok(!run.log.some((entry) => entry.received === "turn/start"));
  } finally {
    await run.cleanup();
  }
});

test("an owner's config with its own server named runnerbox runs no turn", async () => {
  const run = await turn("answer", { ownerHome: true, ownerServers: [{ name: "runnerbox", enabled: true }] });
  try {
    assert.match(stoppedWith(run.exit), /MCP server named `runnerbox`/);
    assert.ok(!run.log.some((entry) => entry.spawned), "app-server never started");
  } finally {
    await run.cleanup();
  }
});
