import assert from "node:assert/strict";
import { test } from "node:test";
import { keptAnswer } from "./keptAnswer.ts";

const loading = { data: undefined, isSuccess: false, isError: false };

test("the last key's data shows as a placeholder while the new key loads, and the new answer replaces it", () => {
  assert.deepEqual(keptAnswer(loading, "week"), { ...loading, data: "week", isPlaceholderData: true });
  assert.deepEqual(keptAnswer({ data: "month", isSuccess: true, isError: false }, "week"), { data: "month", isSuccess: true, isError: false, isPlaceholderData: false });
});

test("a new key that fails drops the last key's data, rather than showing it as the answer", () => {
  assert.deepEqual(keptAnswer({ data: undefined, isSuccess: false, isError: true }, "week"), { data: undefined, isSuccess: false, isError: true, isPlaceholderData: false });
});
