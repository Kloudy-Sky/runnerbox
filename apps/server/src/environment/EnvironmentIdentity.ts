import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { join } from "node:path";
import { type EnvironmentDescriptor, PROTOCOL_VERSION } from "@runnerbox/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import packageJson from "../../package.json" with { type: "json" };
import * as ServerPaths from "../config/ServerPaths.ts";

export class EnvironmentIdError extends Schema.TaggedError<EnvironmentIdError>()("EnvironmentIdError", {
  cause: Schema.Defect(),
}) {
  override get message() {
    return "Couldn't read or create this environment's ID.";
  }
}

// One environment is one state directory. Its ID outlives restarts and address changes, so a
// client can tell it's reaching the same machine by any route.
export class EnvironmentIdentity extends Context.Service<
  EnvironmentIdentity,
  { readonly descriptor: EnvironmentDescriptor }
>()("runnerbox/server/EnvironmentIdentity") {}

const UUID = /^[0-9a-f-]{36}$/;

const make = (label: string | undefined) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const { serverDir } = yield* ServerPaths.ServerPaths;
    const path = join(serverDir, "environment-id");
    yield* fs.makeDirectory(serverDir, { recursive: true, mode: 0o700 });
    const read = fs.readFileString(path).pipe(
      Effect.map((text) => text.trim()),
      Effect.orElseSucceed(() => ""),
    );
    let environmentId = yield* read;
    if (!UUID.test(environmentId)) {
      // `wx` lets only one of two servers starting at once create it; the other reads the winner's.
      // A file left empty by a crash is replaced.
      const flag = environmentId === "" ? "wx" : "w";
      yield* fs.writeFileString(path, `${randomUUID()}\n`, { flag, mode: 0o600 }).pipe(Effect.ignore);
      environmentId = yield* read;
    }
    if (!UUID.test(environmentId)) return yield* new EnvironmentIdError({ cause: new Error("ID file unreadable") });
    return EnvironmentIdentity.of({
      descriptor: {
        environmentId,
        label: label ?? hostname(),
        serverVersion: packageJson.version,
        protocolVersion: PROTOCOL_VERSION,
      },
    });
  }).pipe(Effect.mapError((cause) => (cause instanceof EnvironmentIdError ? cause : new EnvironmentIdError({ cause }))));

export const layer = (label?: string) => Layer.effect(EnvironmentIdentity, make(label));
