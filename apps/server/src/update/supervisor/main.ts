import { Supervisor } from "./Supervisor.ts";
import { readRecord, updatePaths } from "./updateFiles.ts";

const CHECK = "--check-supervisor=";

// `runnerbox serve` as a service manager starts it: the supervisor, running this same file again
// as the server. An update first runs a download's supervisor with `--check-supervisor=<file>`,
// which reads that install's update record as a start would, so a release whose supervisor can't
// even do that is never put in place.
const [file = "", ...args] = process.argv.slice(1);
const check = args[0] === "serve" && args[1]?.startsWith(CHECK) ? args[1].slice(CHECK.length) : null;
if (check !== null) {
  await readRecord(updatePaths(check).record);
  console.log("ok");
  process.exit(0);
}
const supervisor = new Supervisor({ node: process.execPath, nodeArgs: process.execArgv, file, args, env: process.env });
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => supervisor.stop(signal));
process.exit(await supervisor.run());
