import { join } from "node:path";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

// Where the server reads what `report` and `up` recorded, and where it keeps its own state. Its own
// files live in `.server`, a name no install can have, so log readers never mistake it for one.
export class ServerPaths extends Context.Service<
  ServerPaths,
  { readonly stateDir: string; readonly serverDir: string }
>()("runnerbox/server/ServerPaths") {}

export const layer = (stateDir: string) =>
  Layer.succeed(ServerPaths, ServerPaths.of({ stateDir, serverDir: join(stateDir, ".server") }));
