import test from "node:test";
import assert from "node:assert/strict";
import { mergeCollectionWithPending } from "../miniprogram/domain/sync.ts";

test("cache merge keeps pending local edits and pending deletes", () => {
  const remote = [{ id: "a", value: "cloud" }, { id: "b", value: "cloud" }, { id: "c", value: "cloud" }];
  const local = [{ id: "a", value: "local edit" }, { id: "d", value: "local new" }];
  const pending = [
    { id: "m1", collection: "articles", action: "upsert", entityId: "a", baseRevision: 1, queuedAt: 1 },
    { id: "m2", collection: "articles", action: "delete", entityId: "b", baseRevision: 0, queuedAt: 1 },
    { id: "m3", collection: "articles", action: "upsert", entityId: "d", baseRevision: 0, queuedAt: 1 }
  ];
  const merged = mergeCollectionWithPending("articles", remote, local, pending);
  assert.deepEqual(merged.find((item) => item.id === "a"), { id: "a", value: "local edit" });
  assert.equal(merged.some((item) => item.id === "b"), false);
  assert.equal(merged.some((item) => item.id === "c"), true);
  assert.equal(merged.some((item) => item.id === "d"), true);
});
