// Fails if the release bundle carries code runnerbox can't redistribute. The Claude Agent SDK is
// "All rights reserved", so threads drive the `claude` CLI already on the machine instead, and
// nothing of the SDK may reach `dist/runnerbox.js`:
//   node scripts/bundle-check.ts [dist/runnerbox.js]
import { readFileSync } from "node:fs";

// Strings only the SDK's own code contains.
const MARKERS = ["@anthropic-ai/claude-agent-sdk", "Anthropic PBC", "CLAUDE_AGENT_SDK_VERSION", "connectSdkMcpServer", "sendMcpServerMessageToCli"];

const path = process.argv[2] ?? "dist/runnerbox.js";
const bundle = readFileSync(path, "utf8");
const found = MARKERS.filter((marker) => bundle.includes(marker));
if (found.length > 0) {
  console.error(`${path} contains Claude Agent SDK code (${found.join(", ")}). It must not be bundled.`);
  process.exit(1);
}
console.log(`${path} has no Claude Agent SDK code.`);
