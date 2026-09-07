import type { Book, BookStamp, ReadingLog } from "./types";

export function dateKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function dateFromKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function isValidDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = dateFromKey(value);
  return !Number.isNaN(date.getTime()) && dateKey(date) === value;
}

export function normalizeReadingLog(log: ReadingLog): ReadingLog | null {
  const title = String(log.bookTitle || "").trim();
  const pages = Math.round(Number(log.pages));
  const minutes = Math.round(Number(log.minutes));
  if (!title || !isValidDateKey(log.date) || !Number.isFinite(pages) || !Number.isFinite(minutes)
    || pages < 0 || minutes < 0 || (pages === 0 && minutes === 0) || pages > 9999 || minutes > 1440) return null;
  if (log.startPage != null || log.endPage != null) {
    if (!Number.isInteger(log.startPage) || !Number.isInteger(log.endPage)
      || log.startPage! < 0 || log.endPage! <= log.startPage! || log.endPage! > 99999
      || pages !== log.endPage! - log.startPage!) return null;
  }
  return {
    ...log,
    bookTitle: title,
    pages: Math.min(pages, 9999),
    minutes: Math.min(minutes, 1440),
    stickerId: Math.min(11, Math.max(0, Math.round(Number(log.stickerId) || 0))),
    stampIconId: log.stampIconId == null ? null : Math.min(8, Math.max(0, Math.round(log.stampIconId)))
  };
}

export function readingStats(logs: ReadingLog[], cursor: Date, goal: number, today = new Date()) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const monthDays = new Set(logs.filter((log) => {
    const date = dateFromKey(log.date);
    return date.getFullYear() === year && date.getMonth() === month;
  }).map((log) => log.date)).size;
  const totalDays = new Set(logs.map((log) => log.date)).size;
  const todayMinutes = logs
    .filter((log) => log.date === dateKey(today))
    .reduce((sum, log) => sum + log.minutes, 0);
  return {
    monthDays,
    totalDays,
    todayMinutes,
    goalProgress: Math.round((monthDays / Math.max(1, goal)) * 100)
  };
}

export function normalizedBookKey(title: string): string {
  return title.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function iconIdForTitle(title: string): number {
  let hash = 0;
  for (const char of normalizedBookKey(title)) hash = ((hash * 31) + (char.codePointAt(0) || 0)) >>> 0;
  return hash % 9;
}

export function earnedBookStamps(logs: ReadingLog[]): BookStamp[] {
  const latestByBook = new Map<string, ReadingLog>();
  [...logs]
    .filter((log) => log.status === "finished")
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)
    .forEach((log) => latestByBook.set(log.bookId || normalizedBookKey(log.bookTitle), log));

  return Array.from(latestByBook.values())
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
    .map((log) => {
      const icon = log.stampIconId == null ? iconIdForTitle(log.bookTitle) : log.stampIconId;
      return { ...log, resolvedIconId: icon };
    });
}

export function stickerSrc(id: number): string {
  return `/assets/reading-stickers/sticker-${Math.min(11, Math.max(0, Math.round(Number(id) || 0))) + 1}.webp`;
}

export function bookProgress(book: Book, logs: ReadingLog[], throughDate = "9999-12-31", excludeId = "") {
  const records = logs.filter((log) => log.bookId === book.id && log.date <= throughDate && log.id !== excludeId)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  const positioned = records.filter((log) => log.endPage != null);
  const currentPage = positioned.length ? positioned[positioned.length - 1].endPage! : 0;
  return {
    currentPage,
    percent: book.totalPages ? Math.min(100, Math.round(currentPage / book.totalPages * 100)) : 0,
    days: new Set(records.map((log) => log.date)).size,
    minutes: records.reduce((sum, log) => sum + log.minutes, 0),
    pages: records.reduce((sum, log) => sum + log.pages, 0)
  };
}

// Preserve existing completion artwork once, before using stable book identities.
export function migrateReadingBooks(existingBooks: Book[], existingLogs: ReadingLog[]) {
  const books = existingBooks.map((book) => ({ ...book }));
  const logs = existingLogs.map((log) => ({ ...log }));
  const legacyIcons = new Map<string, number>();
  const used = new Set<number>();
  const latest = new Map<string, ReadingLog>();
  [...logs].filter((log) => log.status === "finished")
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)
    .forEach((log) => latest.set(log.bookId || normalizedBookKey(log.bookTitle), log));
  [...latest.values()].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).forEach((log) => {
    let icon = log.stampIconId ?? iconIdForTitle(log.bookTitle);
    if (!log.bookId) while (used.has(icon) && used.size < 9) icon = (icon + 1) % 9;
    used.add(icon);
    legacyIcons.set(log.bookId || normalizedBookKey(log.bookTitle), icon);
  });
  const changedLogs: ReadingLog[] = [];
  const addedBooks: Book[] = [];
  [...logs].sort((a, b) => a.createdAt - b.createdAt).forEach((log) => {
    if (log.bookId && books.some((book) => book.id === log.bookId)) return;
    let book = books.find((item) => normalizedBookKey(item.title) === normalizedBookKey(log.bookTitle));
    if (!book) {
      const recent = [...logs].filter((item) => normalizedBookKey(item.bookTitle) === normalizedBookKey(log.bookTitle))
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];
      book = { id: log.bookId || `book-${log.id}`, title: log.bookTitle.trim(), author: "", totalPages: 0,
        stickerId: recent.stickerId, stampIconId: legacyIcons.get(normalizedBookKey(log.bookTitle)) ?? iconIdForTitle(log.bookTitle),
        createdAt: log.createdAt, updatedAt: recent.updatedAt };
      books.push(book);
      addedBooks.push(book);
    }
    log.bookId = book.id;
    log.stampIconId = log.stampIconId ?? book.stampIconId;
    changedLogs.push(log);
  });
  return { books, logs, addedBooks, changedLogs };
}

export function formatChineseDate(value: string): string {
  const date = dateFromKey(value);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}
