import { Supervisor } from "./Supervisor.ts";

// `runnerbox serve` as a service manager starts it: the supervisor, running this same file again
// as the server.
const [file = "", ...args] = process.argv.slice(1);
const supervisor = new Supervisor({ node: process.execPath, nodeArgs: process.execArgv, file, args, env: process.env });
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => supervisor.stop(signal));
process.exit(await supervisor.run());
