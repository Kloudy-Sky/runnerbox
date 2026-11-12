import { chmod, lstat, mkdir, unlink } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { type } from "arktype";
import { ReproduceRefused, type Reproducer } from "./reproducer.ts";
import { ReproduceRequest, type ReproduceResponse } from "./protocol.ts";

const MAX_REQUEST_BYTES = 64 * 1024;

// `<state>/<install>/reproduce/up.sock`. The directory is the owner's alone, so nobody else can
// reach the socket or put one in its place, and `runnerbox serve` checks the same before it connects.
export const socketPath = (installStateDir: string) => join(installStateDir, "reproduce", "up.sock");

const uid = () => process.getuid?.() ?? -1;

// Throws unless `path` belongs to this user and gives no one else any access.
async function ownedByMe(path: string, what: string) {
  const { uid: owner, mode } = await lstat(path);
  if (owner !== uid()) throw new Error(`${path} belongs to another user, so ${what} won't use it.`);
  if ((mode & 0o077) !== 0) throw new Error(`${path} is open to other users (mode ${(mode & 0o777).toString(8)}), so ${what} won't use it.`);
}

// Listens for `runnerbox serve`'s requests and answers each with one JSON line.
export async function listenForReproduce(installStateDir: string, reproducer: Reproducer): Promise<Server> {
  const path = socketPath(installStateDir);
  const dir = join(installStateDir, "reproduce");
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
    const reply = (response: ReproduceResponse) => connection.end(`${JSON.stringify(response)}\n`);
    connection.on("error", () => {});
    connection.on("data", (chunk: string) => {
      received += chunk;
      if (received.length > MAX_REQUEST_BYTES) return reply({ ok: false, error: "That request is too large." });
      const newline = received.indexOf("\n");
      if (newline < 0) return;
      connection.removeAllListeners("data");
      void answer(reproducer, received.slice(0, newline)).then(reply);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => resolve());
  });
  await chmod(path, 0o600);
  return server;
}

async function answer(reproducer: Reproducer, line: string): Promise<ReproduceResponse> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { ok: false, error: "That request isn't JSON." };
  }
  const request = ReproduceRequest(parsed);
  if (request instanceof type.errors) return { ok: false, error: `That request isn't valid: ${request.summary}` };
  try {
    switch (request.op) {
      case "start":
        return { ok: true, ...(await reproducer.start(request)) };
      case "exec":
        return { ok: true, ...(await reproducer.exec(request)) };
      case "stop":
        return { ok: true, ...(await reproducer.stop(request.id)) };
    }
  } catch (error) {
    // Refusals are meant for the user. Anything else is a fault, and its details stay in up's log.
    if (error instanceof ReproduceRefused) return { ok: false, error: error.message };
    console.log(`reproduce: ${error instanceof Error ? error.message : error}`);
    return { ok: false, error: "up couldn't do that. Its log says why." };
  }
}
