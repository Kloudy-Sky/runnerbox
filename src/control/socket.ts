import { chmod, lstat, mkdir, unlink } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { dirname, join } from "node:path";
import { type } from "arktype";
import { ChangeRefused, type Changes } from "../changes/changes.ts";
import { ReproduceRefused, type Reproducer } from "../reproduce/reproducer.ts";
import { ControlRequest, type ControlResponse } from "./protocol.ts";

const MAX_REQUEST_BYTES = 64 * 1024;

// `<state>/<install>/control/up.sock`. The directory is the owner's alone, so nobody else can reach
// the socket or put one in its place, and `runnerbox serve` checks the same before it connects.
export const controlSocketPath = (installStateDir: string) => join(installStateDir, "control", "up.sock");
// Where the socket was before proposals, answered too for one release so a `serve` that's older
// than this `up` still reaches reproduce. Remove once both have moved on.
export const legacyReproduceSocketPath = (installStateDir: string) => join(installStateDir, "reproduce", "up.sock");

// What this install answers. A part it doesn't have is refused, so its socket only does what its
// config turned on.
export type ControlHandlers = { readonly reproducer: Reproducer | null; readonly changes: Changes | null };

const uid = () => process.getuid?.() ?? -1;

// Throws unless `path` belongs to this user and gives no one else any access.
async function ownedByMe(path: string, what: string) {
  const { uid: owner, mode } = await lstat(path);
  if (owner !== uid()) throw new Error(`${path} belongs to another user, so ${what} won't use it.`);
  if ((mode & 0o077) !== 0) throw new Error(`${path} is open to other users (mode ${(mode & 0o777).toString(8)}), so ${what} won't use it.`);
}

async function listenAt(path: string, handlers: ControlHandlers): Promise<Server> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await ownedByMe(dir, "up");
  // A socket left by an earlier `up` is ours to replace; anything else in its place is refused.
  const existing = await lstat(path).catch(() => null);
  if (existing) {
    if (!existing.isSocket() || existing.uid !== uid()) throw new Error(`${path} isn't a socket this user made, so up won't replace it.`);
    await unlink(path);
  }
  const server = createServer((connection) => {
    let received = "";
    connection.setEncoding("utf8");
    const reply = (response: ControlResponse) => connection.end(`${JSON.stringify(response)}\n`);
    connection.on("error", () => {});
    connection.on("data", (chunk: string) => {
      received += chunk;
      if (received.length > MAX_REQUEST_BYTES) return reply({ ok: false, error: "That request is too large." });
      const newline = received.indexOf("\n");
      if (newline < 0) return;
      connection.removeAllListeners("data");
      void answer(handlers, received.slice(0, newline)).then(reply);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => resolve());
  });
  await chmod(path, 0o600);
  return server;
}

// Listens for `runnerbox serve`'s requests and answers each with one JSON line.
export async function listenForControl(installStateDir: string, handlers: ControlHandlers): Promise<{ close: () => void }> {
  const servers = [await listenAt(controlSocketPath(installStateDir), handlers)];
  if (handlers.reproducer) servers.push(await listenAt(legacyReproduceSocketPath(installStateDir), handlers));
  return { close: () => servers.forEach((server) => server.close()) };
}

async function answer({ reproducer, changes }: ControlHandlers, line: string): Promise<ControlResponse> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { ok: false, error: "That request isn't JSON." };
  }
  const request = ControlRequest(parsed);
  if (request instanceof type.errors) return { ok: false, error: `That request isn't valid: ${request.summary}` };
  const noReproduce = { ok: false as const, error: "This install has no reproduce block." };
  const noChanges = { ok: false as const, error: 'This install doesn\'t take proposals: its config has no "changes": true.' };
  try {
    switch (request.op) {
      case "start":
        return reproducer ? { ok: true, ...(await reproducer.start(request)) } : noReproduce;
      case "exec":
        return reproducer ? { ok: true, ...(await reproducer.exec(request)) } : noReproduce;
      case "stop":
        return reproducer ? { ok: true, ...(await reproducer.stop(request.id)) } : noReproduce;
      case "status":
        return reproducer ? { ok: true, ...reproducer.status(request.id) } : noReproduce;
      case "describe":
        return changes ? { ok: true, ...(await changes.describe()) } : noChanges;
      case "apply":
        return changes ? { ok: true, ...(await changes.apply(request)) } : noChanges;
    }
  } catch (error) {
    // Refusals are meant for the user. Anything else is a fault, and its details stay in up's log.
    if (error instanceof ReproduceRefused || error instanceof ChangeRefused) return { ok: false, error: error.message };
    console.log(`control: ${error instanceof Error ? error.message : error}`);
    return { ok: false, error: "up couldn't do that. Its log says why." };
  }
}
