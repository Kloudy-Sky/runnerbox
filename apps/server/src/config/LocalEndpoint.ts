import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

// Where this server answers on its own machine, for a process it starts that calls back, such as
// a thread's agent reaching `/mcp`. A wildcard bind is reached over loopback.
export class LocalEndpoint extends Context.Service<LocalEndpoint, { readonly baseUrl: string }>()("runnerbox/server/LocalEndpoint") {}

const reachable = (host: string) => (host === "0.0.0.0" || host === "::" || host === "" ? "127.0.0.1" : host.includes(":") ? `[${host}]` : host);

export const layer = (host: string, port: number) => Layer.succeed(LocalEndpoint, LocalEndpoint.of({ baseUrl: `http://${reachable(host)}:${port}` }));
