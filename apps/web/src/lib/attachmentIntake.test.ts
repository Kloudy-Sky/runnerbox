import assert from "node:assert/strict";
import { test } from "node:test";
import { precheck } from "./attachmentIntake.ts";

const MB = 1024 * 1024;

test("the composer refuses what the server would, at once and in the same words", () => {
  assert.deepEqual(precheck({ name: "shot.png", size: 2 * MB, type: "image/png" }, 0), { kind: "image" });
  assert.deepEqual(precheck({ name: "step.log", size: 4000, type: "" }, 4), { kind: "text" });
  const refusal = (result: ReturnType<typeof precheck>) => ("refusal" in result ? result.refusal : null);
  assert.match(refusal(precheck({ name: "huge.png", size: 11 * MB, type: "image/png" }, 0)) ?? "", /Images can be up to 10 MB/);
  assert.match(refusal(precheck({ name: "build.log", size: 300 * 1024, type: "text/plain" }, 0)) ?? "", /text files up to 200 KB/);
  assert.match(refusal(precheck({ name: "logs.zip", size: 1000, type: "application/zip" }, 0)) ?? "", /Only PNG, JPEG, GIF and WebP/);
  assert.match(refusal(precheck({ name: "photo.heic", size: 1000, type: "image/heic" }, 0)) ?? "", /Only PNG, JPEG, GIF and WebP/);
  assert.match(refusal(precheck({ name: "sixth.png", size: 1000, type: "image/png" }, 5)) ?? "", /up to 5 files/);
});
