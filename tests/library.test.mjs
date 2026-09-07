import test from "node:test";
import assert from "node:assert/strict";
import {
  filterArticles,
  getArticleCountForFolder,
  getFolderDescendantIds,
  hasSiblingFolderName,
  validateFolderMove,
  visibleTagCount
} from "../miniprogram/domain/library.ts";

const folders = [
  { id: "root", name: "研究", parentId: null, sortOrder: 0 },
  { id: "child", name: "方法", parentId: "root", sortOrder: 0 },
  { id: "other", name: "写作", parentId: null, sortOrder: 1 }
].map((folder) => ({ ...folder, createdAt: 1, updatedAt: 1 }));

const emptyContent = { contentDelta: { ops: [] }, contentHtml: "", embeddedAssets: [], ocr: { status: "none", fullText: "", highlightedText: "", confidence: null, error: "", updatedAt: null } };
const articles = [
  { ...emptyContent, id: "a", type: "article", title: "田野阅读", excerpt: "观察记录", contentText: "媒介与生活", folderId: "child", tagIds: ["tag-a"], favorite: true, revision: 1, createdAt: 1, updatedAt: 3 },
  { ...emptyContent, id: "b", type: "article", title: "写作草稿", excerpt: "结构", contentText: "论证", folderId: "other", tagIds: ["tag-b"], favorite: false, revision: 1, createdAt: 1, updatedAt: 2 }
];

test("tag overflow reserves its button and keeps a contiguous prefix", () => {
  assert.equal(visibleTagCount([], 300), 0);
  assert.equal(visibleTagCount(["阅读", "写作"], 98), 2);
  assert.equal(visibleTagCount(["阅读", "写作", "方法"], 100), 1);
  assert.equal(visibleTagCount(["很长很长的标签", "短", "短"], 100), 0);
  for (const viewport of [320, 375, 390, 430]) {
    const count = visibleTagCount(Array(10).fill("阅读"), viewport * (1 - 56 / 750));
    assert.ok(count * 52 + 44 <= viewport * (1 - 56 / 750));
  }
});
const tags = [
  { id: "tag-a", name: "田野", colorId: "sage", createdAt: 1, updatedAt: 1 },
  { id: "tag-b", name: "写作", colorId: "forest", createdAt: 1, updatedAt: 1 }
];

test("folder counts include second-level descendants", () => {
  assert.deepEqual([...getFolderDescendantIds(folders, "root")].sort(), ["child", "root"]);
  assert.equal(getArticleCountForFolder(articles, folders, "root"), 1);
});

test("folder move validation blocks third levels and cycles", () => {
  assert.equal(validateFolderMove(folders, "root", "child").ok, false);
  assert.equal(validateFolderMove(folders, "other", "child").ok, false);
  assert.equal(validateFolderMove(folders, "child", "other").ok, true);
  assert.equal(hasSiblingFolderName(folders, " 研究 ", null), true);
});

test("article filtering combines folders, tags, favorites, and full-text search", () => {
  assert.deepEqual(filterArticles(articles, folders, tags, { filter: "folder:root", tagIds: ["tag-a"], query: "媒介" }).map((item) => item.id), ["a"]);
  assert.deepEqual(filterArticles(articles, folders, tags, { filter: "favorite", tagIds: [], query: "田野" }).map((item) => item.id), ["a"]);
  assert.equal(filterArticles(articles, folders, tags, { filter: "archive", tagIds: ["tag-b"], query: "" }).length, 1);
});
