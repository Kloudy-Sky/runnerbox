import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { hostname } from "node:os";
import { join } from "node:path";
import { type EnvironmentDescriptor, PROTOCOL_VERSION, serverProofMessage } from "@runnerbox/contracts";
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
    return "Couldn't read or create this environment's ID or key.";
  }
}

// One environment is one state directory. Its ID and Ed25519 key outlive restarts and address
// changes, so a client can tell it's reaching the same machine by any route. Clients pin the
// public key at pairing; the Connect relay pins it at linking.
export class EnvironmentIdentity extends Context.Service<
  EnvironmentIdentity,
  {
    readonly descriptor: EnvironmentDescriptor;
    readonly key: { readonly publicKey: string; readonly privateKey: string };
    // Signs a client's nonce, so it can check this server holds the key before sending a credential.
    readonly proveTo: (nonce: string) => string;
  }
>()("runnerbox/server/EnvironmentIdentity") {}

const UUID = /^[0-9a-f-]{36}$/;
const KeyFile = Schema.fromJsonString(Schema.Struct({ publicKey: Schema.String, privateKey: Schema.String }));
const decodeKey = Schema.decodeUnknownOption(KeyFile);

const make = (label: string | undefined) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const { serverDir } = yield* ServerPaths.ServerPaths;
    yield* fs.makeDirectory(serverDir, { recursive: true, mode: 0o700 });
    const readOrEmpty = (path: string) => fs.readFileString(path).pipe(Effect.orElseSucceed(() => ""));
    // `wx` lets only one of two servers starting at once create a file; the other reads the
    // winner's. A file left empty or broken by a crash is replaced.
    const create = (path: string, text: string, existing: string) =>
      fs.writeFileString(path, text, { flag: existing === "" ? "wx" : "w", mode: 0o600 }).pipe(Effect.ignore);

    const idPath = join(serverDir, "environment-id");
    let environmentId = (yield* readOrEmpty(idPath)).trim();
    if (!UUID.test(environmentId)) {
      yield* create(idPath, `${randomUUID()}\n`, environmentId);
      environmentId = (yield* readOrEmpty(idPath)).trim();
    }
    if (!UUID.test(environmentId)) return yield* new EnvironmentIdError({ cause: new Error("ID file unreadable") });

    const keyPath = join(serverDir, "environment-key.json");
    let keyText = yield* readOrEmpty(keyPath);
    // Only a missing key is made. Replacing a broken one would break every client's pin and the
    // relay link, so that stops the server instead.
    if (keyText === "") {
      const pair = generateKeyPairSync("ed25519", { publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
      yield* create(keyPath, JSON.stringify(pair), keyText);
      keyText = yield* readOrEmpty(keyPath);
    }
    const key = decodeKey(keyText);
    if (key._tag === "None") return yield* new EnvironmentIdError({ cause: new Error("key file unreadable") });

    return EnvironmentIdentity.of({
      descriptor: {
        environmentId,
        label: label ?? hostname(),
        serverVersion: packageJson.version,
        protocolVersion: PROTOCOL_VERSION,
        publicKey: key.value.publicKey,
      },
      key: key.value,
      proveTo: (nonce) => sign(null, Buffer.from(serverProofMessage(environmentId, nonce)), key.value.privateKey).toString("base64url"),
    });
  }).pipe(Effect.mapError((cause) => (cause instanceof EnvironmentIdError ? cause : new EnvironmentIdError({ cause }))));

export const layer = (label?: string) => Layer.effect(EnvironmentIdentity, make(label));
