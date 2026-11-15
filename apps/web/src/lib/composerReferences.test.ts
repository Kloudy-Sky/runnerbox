import assert from "node:assert/strict";
import { test } from "node:test";
import { referenceToken, withReferences } from "./composerReferences.ts";

test("a reference picked with @ goes as @label in the text and as a thread or run beside it, once", () => {
  const thread = referenceToken({ kind: "thread", id: "0123456789abcdef", label: "ci / test fails on this machine", detail: "" });
  const run = referenceToken({ kind: "run", repo: "owner/name", jobId: 5217, label: "ci / build #81", detail: "" });
  const sent = withReferences(`Same as ${thread}and ${run}and again ${thread}?`, 7);
  assert.equal(sent.text, "Same as @ci / test fails on this machine and @ci / build #81 and again @ci / test fails on this machine ?");
  assert.deepEqual(sent.references, [
    { _tag: "thread", id: "0123456789abcdef" },
    { _tag: "run", repo: "owner/name", jobId: 5217, days: 7 },
  ]);
  assert.equal(sent.tooMany, false);
});

test("more references than the server takes are caught before sending", () => {
  const tokens = ["0123456789abcde0", "0123456789abcde1", "0123456789abcde2", "0123456789abcde3"].map((id) => referenceToken({ kind: "thread", id, label: id, detail: "" }));
  assert.equal(withReferences(tokens.join(""), 7).tooMany, true);
});
