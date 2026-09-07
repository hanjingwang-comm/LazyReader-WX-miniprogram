import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

function harness() {
  const modules = new Map();
  const storage = new Map();
  const toasts = [];
  let page;
  let failSave = false;
  let navigatedBack = false;
  const wx = {
    getWindowInfo: () => ({ statusBarHeight: 47, windowWidth: 390 }),
    getMenuButtonBoundingClientRect: () => ({ bottom: 87 }),
    showModal: async () => ({ confirm: true }),
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => {
      if (failSave) throw new Error("quota exceeded");
      storage.set(key, JSON.parse(JSON.stringify(value)));
    },
    showToast: (value) => toasts.push(value),
    navigateBack: () => { navigatedBack = true; }
  };
  function load(relative) {
    const filename = path.resolve(relative);
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText;
    const require = (specifier) => load(path.resolve(path.dirname(filename), `${specifier}.ts`));
    new Function("require", "module", "exports", "wx", "Page", code)(require, module, module.exports, wx, (definition) => {
      page = definition;
      page.data = structuredClone(page.data);
      page.setData = (patch) => Object.assign(page.data, patch);
    });
    return module.exports;
  }
  const repository = load("miniprogram/services/repository.ts").repository;
  return { repository, storage, toasts, load, wx, page: () => page, failSave: () => { failSave = true; },
    restoreSave: () => { failSave = false; }, navigatedBack: () => navigatedBack };
}

test("book rename and cover update keep article associations and completion icons", async () => {
  const h = harness();
  const r = h.repository;
  await r.initialize();
  const book = r.saveBook({ title: "Test Book", author: "", totalPages: 100, stickerId: 2 }).book;
  const article = r.createArticle({ title: "Excerpt", folderId: "reading", bookId: book.id });
  const entry = { id: "log1", bookId: book.id, bookTitle: book.title, pages: 20, minutes: 0, date: "2026-09-07",
    startPage: 0, endPage: 20, status: "finished", stickerId: 0, stampIconId: null, createdAt: 1, updatedAt: 1 };
  assert.ok(r.saveReadingLog(entry).log);
  r.saveBook({ ...book, title: "Renamed", stickerId: 5 });
  const state = r.getState();
  assert.equal(state.readingLogs[0].bookTitle, "Renamed");
  assert.equal(state.readingLogs[0].stickerId, 5);
  assert.equal(state.readingLogs[0].stampIconId, book.stampIconId);
  assert.equal(r.getArticle(article.id).bookId, book.id);
  assert.ok(r.saveReadingLog({ ...entry, endPage: 120, pages: 120 }).error);
  assert.ok(r.saveBook({ ...book, id: undefined, title: "Renamed" }).error);
  assert.equal(h.storage.get("lazyreader.state.v1").books[0].title, "Renamed");
});

test("quick checkin remembers book and computes position-based pages", async () => {
  const h = harness();
  const r = h.repository;
  await r.initialize();
  const book = r.saveBook({ title: "Book", author: "", totalPages: 100, stickerId: 3 }).book;
  r.saveReadingLog({ id: "prior", bookId: book.id, bookTitle: book.title, pages: 20, minutes: 0, date: "2026-09-01",
    startPage: 0, endPage: 20, status: "reading", stickerId: 3, stampIconId: null, createdAt: 1, updatedAt: 1 });
  h.load("miniprogram/pages/checkin/checkin.ts");
  const page = h.page();
  const tabBar = { hidden: false };
  page.getTabBar = () => ({ setData: (patch) => Object.assign(tabBar, patch) });
  page._state = r.getState();
  page.data.selectedDate = "2026-09-07";
  page.render();
  page.openCreate();
  assert.equal(tabBar.hidden, true);
  assert.equal(page.data.formBookId, book.id);
  assert.equal(page.data.startPage, "20");
  page.setData({ pageMode: "position", endPage: "35", formMinutes: "" });
  page.saveLog();
  const saved = r.getState().readingLogs.find((log) => log.id !== "prior");
  assert.equal(saved.pages, 15);
  assert.equal(saved.minutes, 0);
  assert.equal(saved.stickerId, 3);
  assert.equal(page.data.formOpen, false);
  assert.equal(tabBar.hidden, false);
  page._state = r.getState();
  page.openEdit({ currentTarget: { dataset: { id: saved.id } } });
  assert.equal(tabBar.hidden, true);
  page.closeForm();
  assert.equal(tabBar.hidden, false);
  page.openEdit({ currentTarget: { dataset: { id: saved.id } } });
  await page.deleteLog();
  assert.equal(tabBar.hidden, false);
  page.openCreate();
  page.setData({ pageMode: "position", startPage: "", endPage: "" });
  page.saveLog();
  assert.equal(page.data.formOpen, true);
  assert.equal(tabBar.hidden, true);
});

test("custom headers stay below the system capsule with a fallback inset", () => {
  const h = harness();
  const { getContentTop } = h.load("miniprogram/services/ui.ts");
  assert.equal(getContentTop(), 99);
  h.wx.getMenuButtonBoundingClientRect = () => ({ bottom: 112 });
  assert.equal(getContentTop(), 120);
  h.wx.getMenuButtonBoundingClientRect = () => { throw new Error("unavailable"); };
  assert.equal(getContentTop(), 99);
  delete h.wx.getMenuButtonBoundingClientRect;
  assert.equal(getContentTop(), 99);
});

test("directory drawer hides bottom navigation and restores it on dismissal", () => {
  const h = harness();
  h.load("miniprogram/pages/library/library.ts");
  const page = h.page();
  const tabBar = { hidden: false };
  page.getTabBar = () => ({ setData: (patch) => Object.assign(tabBar, patch) });
  page.toggleDrawer();
  assert.equal(tabBar.hidden, true);
  page.closeDrawer();
  assert.equal(tabBar.hidden, false);
  page.toggleDrawer();
  page.selectSystemFilter({ currentTarget: { dataset: { filter: "all" } } });
  assert.equal(tabBar.hidden, false);
  page.toggleDrawer();
  page.toggleDrawer();
  assert.equal(tabBar.hidden, false);
});

test("unsaved title survives repository notifications and failed save can be retried", async () => {
  const h = harness();
  const r = h.repository;
  await r.initialize();
  const article = r.createArticle({ title: "Old", folderId: "reading" });
  h.load("miniprogram/package-content/pages/editor/editor.ts");
  const page = h.page();
  page.data.articleId = article.id;
  page._state = r.getState();
  page.renderArticle();
  page._titleDirty = true;
  page.data.title = "Unsaved title";
  page.renderArticle();
  assert.equal(page.data.title, "Unsaved title");
  page._pendingEditor = { delta: { ops: [{ insert: "draft\n" }] }, html: "<p>draft</p>", text: "draft" };
  h.failSave();
  page.goBack();
  assert.equal(h.navigatedBack(), false);
  assert.ok(page._pendingEditor);
  assert.equal(h.toasts.some((toast) => toast.title === "已保存"), false);
  h.restoreSave();
  page.saveNow(false);
  assert.equal(h.storage.get("lazyreader.state.v1").articles[0].contentText, "draft");
  assert.equal(page._pendingEditor, null);
});
