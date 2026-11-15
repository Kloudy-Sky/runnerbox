import { type ChildProcess, spawn } from "node:child_process";
import { constants } from "node:os";
import { type ChildContext, SUPERVISED_ENV, SUPERVISOR_PROTOCOL } from "./protocol.ts";

export type SupervisorOptions = {
  // How to run runnerbox.js again: Node, its flags, the file, and the arguments after the file.
  readonly node: string;
  readonly nodeArgs: ReadonlyArray<string>;
  readonly file: string;
  readonly args: ReadonlyArray<string>;
  readonly env: NodeJS.ProcessEnv;
  // How long a stopped server gets before it's killed.
  readonly stopGraceMs?: number;
};

// The server only needs a second to close its listeners; anything longer is stuck.
const STOP_GRACE_MS = 10_000;

const exitCodeOf = (code: number | null, signal: NodeJS.Signals | null) => code ?? 128 + (signal ? constants.signals[signal] : 0);

// Runs the server as its child and lives exactly as long as it does, so the service manager's
// restart policy still applies. It stays this small on purpose: an update replaces the server,
// never the supervisor that is already in memory.
//   const supervisor = new Supervisor(options); process.on("SIGTERM", () => supervisor.stop("SIGTERM"));
//   process.exit(await supervisor.run());
export class Supervisor {
  readonly #options: SupervisorOptions;
  #child: ChildProcess | null = null;
  #stopping = false;

  constructor(options: SupervisorOptions) {
    this.#options = options;
  }

  // Starts the server and resolves with the exit code to leave with once it has exited.
  run(): Promise<number> {
    const { node, nodeArgs, file, args, env } = this.#options;
    const context: ChildContext = { protocol: SUPERVISOR_PROTOCOL, file, role: "active" };
    const child = spawn(node, [...nodeArgs, file, ...args], {
      env: { ...env, [SUPERVISED_ENV]: JSON.stringify(context) },
      stdio: ["inherit", "inherit", "inherit", "ipc"],
    });
    this.#child = child;
    return new Promise((resolve) => {
      child.once("error", (error) => {
        process.stderr.write(`runnerbox: couldn't start the server: ${error.message}\n`);
        resolve(1);
      });
      child.once("exit", (code, signal) => {
        this.#child = null;
        resolve(exitCodeOf(code, signal));
      });
    });
  }

  // Passes a stop signal on, and kills a server that hasn't exited after the grace period.
  stop(signal: NodeJS.Signals) {
    const child = this.#child;
    if (child === null) return;
    child.kill(signal);
    if (this.#stopping) return;
    this.#stopping = true;
    setTimeout(() => child.kill("SIGKILL"), this.#options.stopGraceMs ?? STOP_GRACE_MS).unref();
  }
}
