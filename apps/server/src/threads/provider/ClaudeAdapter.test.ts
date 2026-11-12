import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as ServerPaths from "../../config/ServerPaths.ts";
import * as ClaudeAdapter from "./ClaudeAdapter.ts";
import { ProviderAdapter, type TurnAccount } from "./ProviderAdapter.ts";

// The real adapter against a stand-in `claude` that says which key it was started with, and
// answers as the CLI does when the API refuses one. No network, no real key.
const FAKE_CLAUDE = `#!/usr/bin/env node
const key = process.env.ANTHROPIC_API_KEY;
if (process.argv[2] === "auth") { console.log(JSON.stringify({ loggedIn: true })); process.exit(0); }
process.stdin.resume();
process.stdin.on("end", () => {
  if (key === "sk-ant-refused-0000") {
    console.log(JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "Invalid API key · Fix external API key" }));
    process.exit(1);
  }
  console.log(JSON.stringify({ type: "assistant", parent_tool_use_id: null, message: { content: [{ type: "text", text: "key=" + (key ?? "none") }] } }));
  console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, total_cost_usd: 0 }));
});
`;

let dir: string;
const saved = { PATH: process.env.PATH, HOME: process.env.HOME, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY };
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "rbx-claude-"));
  await writeFile(join(dir, "claude"), FAKE_CLAUDE);
  await chmod(join(dir, "claude"), 0o755);
  process.env.PATH = `${dir}:${saved.PATH}`;
  // Nothing from the real home directory, such as an installed `claude`, is found.
  process.env.HOME = dir;
  // A key in the server's own environment, which no turn may use.
  process.env.ANTHROPIC_API_KEY = "sk-ant-ambient-9999";
});
after(async () => {
  Object.assign(process.env, saved);
  await rm(dir, { recursive: true, force: true });
});

const turn = (account: TurnAccount) =>
  Effect.gen(function* () {
    const adapter = yield* ProviderAdapter;
    return yield* adapter.runTurn({ systemPrompt: "prompt", prompt: "Why?", mcp: { url: "http://127.0.0.1:9/mcp", token: "rbx_turn" }, reproduce: false, account }).pipe(Stream.runCollect);
  }).pipe(
    Effect.provide(ClaudeAdapter.layer.pipe(Layer.provide(ServerPaths.layer(dir)), Layer.provideMerge(NodeServices.layer))),
    Effect.scoped,
    Effect.runPromise,
  );

test("a turn's account key reaches claude, and the server's own key never does", async () => {
  const subscription = [...(await turn({ label: "Claude, subscription", model: null, apiKey: null }))];
  assert.deepEqual(subscription.find((event) => event._tag === "Text"), { _tag: "Text", text: "key=none" });
  const api = [...(await turn({ label: "Claude, API", model: null, apiKey: "sk-ant-example-1234" }))];
  assert.deepEqual(api.find((event) => event._tag === "Text"), { _tag: "Text", text: "key=sk-ant-example-1234" });
});

test("a key the API refuses fails the turn with a message that says what to do", async () => {
  await assert.rejects(turn({ label: "Claude, work key", model: null, apiKey: "sk-ant-refused-0000" }), (error: Error) =>
    /The API key for "Claude, work key" was refused\. Replace it in Settings, Accounts\./.test(error.message),
  );
});
