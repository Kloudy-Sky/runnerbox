import type { SshRoute } from "@runnerbox/client-runtime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

// Arguments for every `ssh` the desktop app runs. ssh is spawned directly, never through a shell,
// so these reach it exactly as built. Key and agent auth only: BatchMode stops ssh from prompting
// for a password, and an unknown host key fails rather than being accepted.

export class SshRouteError extends Error {}

const PORT = (value: number | null) => value === null || (Number.isInteger(value) && value > 0 && value < 65536);

function hostArgs(route: SshRoute) {
  // A host starting with `-` would be read as an option, such as -oProxyCommand.
  if (!/^[A-Za-z0-9_.@:[\]%-]+$/.test(route.host) || route.host.startsWith("-")) throw new SshRouteError(`Not an SSH host: ${route.host}`);
  if (!PORT(route.sshPort) || !PORT(route.remotePort)) throw new SshRouteError("Ports must be between 1 and 65535.");
  return [
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=10",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=3",
    ...(route.sshPort === null ? [] : ["-p", String(route.sshPort)]),
  ];
}

// Forwards 127.0.0.1:<localPort> here to the server's loopback port there, and nothing else.
// ExitOnForwardFailure makes ssh exit, rather than sit connected, when the port can't be bound.
export function tunnelArgs(route: SshRoute, localPort: number) {
  if (!PORT(localPort)) throw new SshRouteError("Ports must be between 1 and 65535.");
  return [...hostArgs(route), "-N", "-o", "ExitOnForwardFailure=yes", "-L", `127.0.0.1:${localPort}:127.0.0.1:${route.remotePort}`, "--", route.host];
}

// Runs `<serverCommand> pair --json` there. ssh hands the remote command to the user's shell on
// that machine, so the command is theirs to write, the same as typing it into ssh.
export function pairArgs(route: SshRoute) {
  if (!route.serverCommand.trim() || /[\n\r]/.test(route.serverCommand)) throw new SshRouteError("The server command must be one line.");
  return [...hostArgs(route), "--", route.host, `${route.serverCommand} pair --json`];
}

const PairOutput = Schema.fromJsonString(Schema.Struct({ code: Schema.String, environmentId: Schema.String }));
const decodePairLine = Schema.decodeUnknownOption(PairOutput);

// The pairing code from `pair --json`, which prints one JSON line. Anything printed before it,
// such as a login banner, is skipped.
export function parsePairOutput(stdout: string) {
  for (const line of stdout.trim().split(/\r?\n/).toReversed()) {
    const decoded = decodePairLine(line);
    if (Option.isSome(decoded)) return decoded.value;
  }
  throw new SshRouteError("The server's pair command printed no pairing code.");
}
