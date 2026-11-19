import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { newestCached } from "./newestCached.ts";

test("while a machine's new key loads, its newest answer to the same call stands in, never another machine's or call's", () => {
  const client = new QueryClient();
  client.setQueryData(["box", "runners.explain", 7, "slot 1 minting"], "older", { updatedAt: 1_000 });
  client.setQueryData(["box", "runners.explain", 7, "slot 1 idle"], "newest", { updatedAt: 2_000 });
  client.setQueryData(["other", "runners.explain", 7, "slot 1 busy"], "another machine", { updatedAt: 3_000 });
  client.setQueryData(["box", "runners.samples", 1], "another call", { updatedAt: 4_000 });
  assert.equal(newestCached<string>(client, ["box", "runners.explain"]), "newest");
  assert.equal(newestCached<string>(client, ["fresh", "runners.explain"]), undefined);
});
