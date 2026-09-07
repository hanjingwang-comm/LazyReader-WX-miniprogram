import test from "node:test";
import assert from "node:assert/strict";
import { bookProgress, earnedBookStamps, migrateReadingBooks, normalizeReadingLog, readingStats } from "../miniprogram/domain/reading.ts";

function log(id, date, bookTitle, status, minutes = 30) {
  return { id, date, bookTitle, pages: 20, minutes, status, stickerId: 0, stampIconId: null, createdAt: Number(id.replace(/\D/g, "")) || 1, updatedAt: 1 };
}

test("reading statistics count unique dates and today's minutes", () => {
  const logs = [
    log("1", "2026-08-02", "A", "reading", 20),
    log("2", "2026-08-02", "B", "reading", 15),
    log("3", "2026-08-03", "A", "finished", 40),
    log("4", "2026-07-01", "C", "reading", 10)
  ];
  const stats = readingStats(logs, new Date(2026, 7, 1), 4, new Date(2026, 7, 2));
  assert.deepEqual(stats, { monthDays: 2, totalDays: 3, todayMinutes: 35, goalProgress: 50 });
});

test("reading entries accept pages or minutes but reject empty and non-finite amounts", () => {
  const entry = log("1", "2026-09-07", "Book", "reading");
  assert.ok(normalizeReadingLog({ ...entry, pages: 0, minutes: 10 }));
  assert.ok(normalizeReadingLog({ ...entry, pages: 10, minutes: 0 }));
  for (const invalid of [{ pages: 0, minutes: 0 }, { pages: NaN }, { minutes: Infinity }, { pages: -1 }, { minutes: 1441 }]) {
    assert.equal(normalizeReadingLog({ ...entry, ...invalid }), null);
  }
  assert.ok(normalizeReadingLog({ ...entry, pages: 20, startPage: 10, endPage: 30 }));
  assert.equal(normalizeReadingLog({ ...entry, pages: 20, startPage: 30, endPage: 10 }), null);
  assert.equal(normalizeReadingLog({ ...entry, pages: 20, startPage: 10, endPage: 40 }), null);
});

test("legacy migration groups equivalent titles, preserves entries and runs only once", () => {
  const logs = [log("1", "2026-08-01", "The Book", "reading"), log("2", "2026-08-03", " The   Book ", "finished")];
  const migrated = migrateReadingBooks([], logs);
  assert.equal(migrated.books.length, 1);
  assert.equal(migrated.changedLogs.length, 2);
  assert.equal(migrated.logs[0].bookId, migrated.logs[1].bookId);
  assert.equal(migrated.logs[0].pages, logs[0].pages);
  assert.equal(logs[0].bookId, undefined);
  const repeated = migrateReadingBooks(migrated.books, migrated.logs);
  assert.equal(repeated.addedBooks.length, 0);
  assert.equal(repeated.changedLogs.length, 0);
  assert.deepEqual(repeated.logs, migrated.logs);
});

test("completion artwork stays fixed when other books finish or a title changes", () => {
  const migrated = migrateReadingBooks([], [log("1", "2026-08-01", "A", "finished"), log("2", "2026-08-02", "J", "finished")]);
  const before = earnedBookStamps(migrated.logs);
  const after = earnedBookStamps([...migrated.logs.map((entry) => ({ ...entry, bookTitle: "Renamed" })),
    { ...log("3", "2026-09-01", "S", "finished"), bookId: "another-book" }]);
  before.forEach((stamp) => assert.equal(after.find((item) => item.id === stamp.id).resolvedIconId, stamp.resolvedIconId));
  assert.equal(after.length, 3);
});

test("progress uses dated page positions and excludes the entry being edited", () => {
  const book = { id: "book", totalPages: 100 };
  const logs = [
    { ...log("1", "2026-08-01", "A", "reading"), bookId: "book", startPage: 0, endPage: 20 },
    { ...log("2", "2026-08-02", "A", "reading"), bookId: "book", startPage: 20, endPage: 40 },
    { ...log("3", "2026-08-03", "A", "reading"), bookId: "other", endPage: 99 }
  ];
  assert.equal(bookProgress(book, logs).currentPage, 40);
  assert.equal(bookProgress(book, logs, "2026-08-01").currentPage, 20);
  assert.equal(bookProgress(book, logs, "2026-08-02", "2").currentPage, 20);
  assert.equal(bookProgress(book, logs).days, 2);
});

test("book stamps are derived from the latest finished record per normalized title", () => {
  const stamps = earnedBookStamps([
    log("1", "2026-08-01", "The Book", "finished"),
    log("2", "2026-08-03", " The   Book ", "finished"),
    log("3", "2026-08-02", "Another", "reading"),
    log("4", "2026-08-04", "Third", "finished")
  ]);
  assert.equal(stamps.length, 2);
  assert.equal(stamps[0].bookTitle, "Third");
  assert.equal(stamps[1].date, "2026-08-03");
  assert.notEqual(stamps[0].resolvedIconId, stamps[1].resolvedIconId);
});
