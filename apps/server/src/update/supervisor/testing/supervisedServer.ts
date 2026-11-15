import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as Effect from "effect/Effect";
import * as Supervision from "../../Supervision.ts";

// The server's half of the supervisor's line, as a real server has it, for a test of both halves
// together. It says it's ready as 0.3.1, asks for the update a test writes to `request.json`
// beside runnerbox.js once it has written `ready` there, and writes what the supervisor answered to `answer.json`.
const program = Effect.gen(function* () {
  const supervision = yield* Supervision.Supervision;
  const context = supervision.context;
  if (context === null) throw new Error("Not supervised.");
  const dir = dirname(context.file);
  yield* supervision.ready("0.3.1");
  writeFileSync(join(dir, "ready"), "");
  const request = join(dir, "request.json");
  while (!existsSync(request)) yield* Effect.sleep("20 millis");
  const asked = JSON.parse(readFileSync(request, "utf8"));
  rmSync(request);
  const answer = yield* supervision.requestUpdate(asked).pipe(
    Effect.map((id) => ({ accepted: id })),
    Effect.catchTag("UpdateRefused", (refused) => Effect.succeed({ refused: refused.reason })),
  );
  writeFileSync(join(dir, "answer.json"), JSON.stringify(answer));
  yield* Effect.never;
});

process.on("SIGTERM", () => process.exit(0));
Effect.runFork(program.pipe(Effect.provide(Supervision.layer)));
