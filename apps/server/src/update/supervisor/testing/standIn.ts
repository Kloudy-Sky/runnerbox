// The source of a stand-in runnerbox.js for supervisor tests. It answers `--version` and the
// supervisor check as a release does, and as a server logs each start and stop to `events.log`
// beside the real file. An active one asks for each update a test writes to `request.json` there,
// and adds each answer to `replies.ndjson`.
export type Behaviour =
  | "good"
  // Exits with an error before it's ready.
  | "crash"
  // Starts, but never says it's ready, as a server that bound only one of its listeners.
  | "never-ready"
  // Says it's ready as a version it isn't.
  | "wrong-version"
  // Prints its version, then never exits.
  | "version-hangs"
  // Fails to print its version, as a release that needs a newer Node.
  | "wont-run";

export const standIn = (version: string, behaviour: Behaviour = "good") => `
const fs = require("node:fs"), path = require("node:path");
const VERSION = ${JSON.stringify(version)}, BEHAVIOUR = ${JSON.stringify(behaviour)};
const args = process.argv.slice(2);
if (args[0] === "--version") {
  if (BEHAVIOUR === "wont-run") { console.error("SyntaxError: this needs Node 99"); process.exit(1); }
  console.log(VERSION + " (releases from owner/name)");
  if (BEHAVIOUR === "version-hangs") setInterval(() => {}, 1000); else process.exit(0);
} else if (args[0] === "serve" && (args[1] || "").startsWith("--check-supervisor=")) {
  console.log("ok");
} else {
  const context = JSON.parse(process.env.RUNNERBOX_SERVE_SUPERVISED);
  const dir = path.dirname(context.file);
  const log = (line) => fs.appendFileSync(path.join(dir, "events.log"), line + "\\n");
  log("start " + VERSION + " " + context.role);
  process.on("SIGTERM", () => { log("stop " + VERSION); process.exit(0); });
  setInterval(() => {}, 1000);
  if (BEHAVIOUR === "crash") { console.error("Error: the state directory is unreadable"); process.exit(1); }
  if (BEHAVIOUR === "good") setTimeout(() => { process.send({ type: "ready", version: VERSION }); log("ready " + VERSION + " " + context.role); }, 50);
  if (BEHAVIOUR === "wrong-version") setTimeout(() => process.send({ type: "ready", version: "9.9.9" }), 50);
  if (context.role === "active") {
    process.on("message", (message) => fs.appendFileSync(path.join(dir, "replies.ndjson"), JSON.stringify(message) + "\\n"));
    setInterval(() => {
      const request = path.join(dir, "request.json");
      if (!fs.existsSync(request)) return;
      const requests = JSON.parse(fs.readFileSync(request, "utf8"));
      fs.rmSync(request);
      for (const each of requests) process.send({ type: "update", ...each });
    }, 20);
  }
}
`;
