import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

// Serves a Workers-style fetch handler on a loopback port, so the server's CLI code reaches the
// relay over real HTTP, as it will in production.
export async function serveFetch(handler: (request: Request) => Promise<Response>) {
  const server = createServer(async (incoming, outgoing) => {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(chunk as Buffer);
    const url = `http://127.0.0.1${incoming.url ?? "/"}`;
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) if (typeof value === "string") headers.set(key, value);
    const body = chunks.length > 0 ? Buffer.concat(chunks) : null;
    const response = await handler(new Request(url, { method: incoming.method ?? "GET", headers, ...(body && incoming.method !== "GET" ? { body } : {}) }));
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
