import { type ChildProcess, execFile, spawn } from "node:child_process";
import { connect, createServer } from "node:net";
import type { SshRoute } from "@runnerbox/client-runtime";
import { pairArgs, parsePairOutput, SshRouteError, tunnelArgs } from "./command.ts";

const READY_TIMEOUT_MS = 15_000;
const PAIR_TIMEOUT_MS = 30_000;
const SSH = process.platform === "win32" ? "ssh.exe" : "ssh";

type Tunnel = { child: ChildProcess; baseUrl: string; ready: Promise<void> };

const key = (route: SshRoute) => JSON.stringify([route.host, route.sshPort, route.remotePort]);

// A port nothing listens on now. Another program could take it before ssh binds it, in which
// case ssh exits (ExitOnForwardFailure) and the next connection attempt picks another.
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Error("no port"))));
    });
  });

const accepts = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });

// SSH port forwards owned by the desktop app's main process. The renderer only ever sees the local
// URL a forward gives it; the remote server keeps binding loopback.
export function createTunnels() {
  const tunnels = new Map<string, Tunnel>();

  async function start(route: SshRoute): Promise<Tunnel> {
    const port = await freePort();
    const child = spawn(SSH, tunnelArgs(route, port), { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => (stderr = (stderr + chunk.toString()).slice(-2000)));
    const exited = new Promise<never>((_, reject) =>
      child.once("exit", (code) => reject(new SshRouteError(stderr.trim() || `ssh exited ${code}`))),
    );
    const listening = (async () => {
      const deadline = Date.now() + READY_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (await accepts(port)) return;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      child.kill();
      throw new SshRouteError("The SSH forward didn't open in time.");
    })();
    const tunnel = { child, baseUrl: `http://127.0.0.1:${port}`, ready: Promise.race([listening, exited]) };
    child.once("exit", () => {
      if (tunnels.get(key(route)) === tunnel) tunnels.delete(key(route));
    });
    tunnels.set(key(route), tunnel);
    return tunnel;
  }

  return {
    // Reuses a live forward for the same route, so reconnecting doesn't spawn another ssh.
    async open(route: SshRoute) {
      const tunnel = tunnels.get(key(route)) ?? (await start(route));
      await tunnel.ready;
      return { baseUrl: tunnel.baseUrl };
    },
    close(route: SshRoute) {
      tunnels.get(key(route))?.child.kill();
      tunnels.delete(key(route));
    },
    closeAll() {
      for (const tunnel of tunnels.values()) tunnel.child.kill();
      tunnels.clear();
    },
    fetchPairingCode: (route: SshRoute) =>
      new Promise<{ code: string; environmentId: string }>((resolve, reject) => {
        execFile(SSH, pairArgs(route), { timeout: PAIR_TIMEOUT_MS }, (error, stdout, stderr) => {
          if (error) return reject(new SshRouteError(stderr.trim().split("\n").at(-1) || error.message));
          try {
            resolve(parsePairOutput(stdout));
          } catch (failure) {
            reject(failure);
          }
        });
      }),
  };
}
