import { createId } from "../../domain/library";
import { bookProgress, dateFromKey, dateKey, formatChineseDate, readingStats, stickerSrc } from "../../domain/reading";
import type { ReadingLog, ReadingStatus, RepositoryState } from "../../domain/types";
import { repository } from "../../services/repository";
import { getContentTop } from "../../services/ui";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
const STATUS_OPTIONS: Array<{ label: string; value: ReadingStatus }> = [
  { label: "阅读中", value: "reading" },
  { label: "已读完", value: "finished" },
  { label: "重读", value: "rereading" }
];

function buildCalendar(cursor: Date, selectedDate: string, logs: ReadingLog[]) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - mondayOffset);
  return Array.from({ length: 42 }, (_unused, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = dateKey(date);
    const dateLogs = logs.filter((log) => log.date === key);
    return {
      key,
      day: date.getDate(),
      inMonth: date.getMonth() === month,
      selected: key === selectedDate,
      hasLog: dateLogs.length > 0,
      count: dateLogs.length,
      stickerSrc: dateLogs.length ? stickerSrc(dateLogs[0].stickerId) : ""
    };
  });
}

Page({
  data: {
    statusBarHeight: 20,
    contentTop: 72,
    weekdays: WEEKDAYS,
    monthTitle: "",
    calendar: [] as ReturnType<typeof buildCalendar>,
    selectedDate: dateKey(new Date()),
    selectedDateLabel: "今天",
    dateLogs: [] as Array<ReadingLog & { statusLabel: string; stickerSrc: string; amountLabel: string }>,
    stats: { monthDays: 0, totalDays: 0, todayMinutes: 0, goalProgress: 0 },
    monthlyGoal: 18,
    formOpen: false,
    editingId: "",
    formDate: dateKey(new Date()),
    formBookTitle: "",
    formBookId: "",
    bookIndex: 0,
    books: [] as Array<{ id: string; title: string; cover: string }>,
    pageMode: "pages",
    startPage: "0",
    endPage: "",
    formPages: "",
    formMinutes: "",
    formStatusIndex: 0,
    statusOptions: STATUS_OPTIONS,
    formStickerId: 0,
    formCover: ""
  },

  _cursor: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  _state: null as RepositoryState | null,
  _unsubscribe: null as null | (() => void),

  async onLoad() {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ statusBarHeight: windowInfo.statusBarHeight || 20, contentTop: getContentTop() });
    await getApp<LazyReaderApp>().globalData.repositoryReady;
    this._unsubscribe = repository.subscribe((state) => {
      this._state = state;
      this.render();
    });
  },

  onShow() {
    const tabBar = typeof this.getTabBar === "function" ? this.getTabBar() : null;
    if (tabBar) tabBar.setData({ selected: 1, hidden: this.data.formOpen });
    void getApp<LazyReaderApp>().globalData.repositoryReady.then(() => {
      const bookId = getApp<LazyReaderApp>().globalData.checkinBookId;
      if (bookId) {
        delete getApp<LazyReaderApp>().globalData.checkinBookId;
        this.openCreate();
        this.selectBook(bookId);
      }
    });
  },

  onUnload() {
    if (this._unsubscribe) this._unsubscribe();
  },

  render() {
    const state = this._state;
    if (!state) return;
    const selected = this.data.selectedDate;
    const today = dateKey(new Date());
    const selectedLogs = state.readingLogs
      .filter((log) => log.date === selected)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((log) => ({
        ...log,
        amountLabel: [log.pages ? `${log.pages} 页` : "", log.minutes ? `${log.minutes} 分钟` : ""].filter(Boolean).join(" · "),
        statusLabel: STATUS_OPTIONS.find((item) => item.value === log.status)?.label || "阅读中",
        stickerSrc: stickerSrc(log.stickerId)
      }));
    this.setData({
      books: state.books.map((book) => ({ id: book.id, title: book.title, cover: stickerSrc(book.stickerId) })),
      monthTitle: `${this._cursor.getFullYear()} 年 ${this._cursor.getMonth() + 1} 月`,
      calendar: buildCalendar(this._cursor, selected, state.readingLogs),
      selectedDateLabel: selected === today ? "今天" : formatChineseDate(selected),
      dateLogs: selectedLogs,
      stats: readingStats(state.readingLogs, this._cursor, state.settings.monthlyReadingGoal),
      monthlyGoal: state.settings.monthlyReadingGoal
    });
  },

  changeMonth(event: any) {
    const delta = Number(event.currentTarget.dataset.delta);
    this._cursor = new Date(this._cursor.getFullYear(), this._cursor.getMonth() + delta, 1);
    this.render();
  },

  selectDate(event: any) {
    const selectedDate = event.currentTarget.dataset.date;
    const date = dateFromKey(selectedDate);
    this._cursor = new Date(date.getFullYear(), date.getMonth(), 1);
    this.setData({ selectedDate });
    this.render();
  },

  openCreate() {
    const state = repository.getState();
    const recent = [...state.readingLogs].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    this.setData({
      formOpen: true,
      editingId: "",
      formDate: this.data.selectedDate,
      formBookTitle: "",
      formBookId: "",
      startPage: "0",
      endPage: "",
      pageMode: "pages",
      formPages: "",
      formMinutes: "",
      formStatusIndex: 0,
      formStickerId: 0
    });
    this.selectBook(recent?.bookId || state.books[0]?.id || "");
    this.updateTabBar();
  },

  selectBook(id: string) {
    const state = repository.getState();
    const book = state.books.find((item) => item.id === id);
    if (!book) return;
    const progress = bookProgress(book, state.readingLogs, this.data.formDate, this.data.editingId);
    this.setData({ formBookId: book.id, formBookTitle: book.title, formStickerId: book.stickerId, formCover: stickerSrc(book.stickerId),
      bookIndex: state.books.findIndex((item) => item.id === id), startPage: String(progress.currentPage), endPage: "" });
  },
  onBookChoice(event: any) { this.selectBook(this.data.books[Number(event.detail.value)]?.id || ""); },
  addBook() { wx.navigateTo({ url: "/package-content/pages/book/book" }); },
  openBook(event: any) { wx.navigateTo({ url: `/package-content/pages/book/book?id=${encodeURIComponent(event.currentTarget.dataset.id)}` }); },
  onPageMode(event: any) { this.setData({ pageMode: event.currentTarget.dataset.mode }); },
  onStartPage(event: any) { this.setData({ startPage: event.detail.value }); },
  onEndPage(event: any) { this.setData({ endPage: event.detail.value }); },

  openEdit(event: any) {
    const id = event.currentTarget.dataset.id;
    const log = this._state?.readingLogs.find((item) => item.id === id);
    if (!log) return;
    this.setData({
      formOpen: true,
      editingId: log.id,
      formDate: log.date,
      formBookTitle: log.bookTitle,
      formBookId: log.bookId || "",
      formCover: stickerSrc(log.stickerId),
      bookIndex: this.data.books.findIndex((book: { id: string }) => book.id === log.bookId),
      pageMode: log.endPage != null ? "position" : "pages",
      startPage: String(log.startPage ?? 0),
      endPage: log.endPage == null ? "" : String(log.endPage),
      formPages: String(log.pages),
      formMinutes: String(log.minutes),
      formStatusIndex: Math.max(0, STATUS_OPTIONS.findIndex((item) => item.value === log.status)),
      formStickerId: log.stickerId
    });
    this.updateTabBar();
  },

  closeForm() {
    this.setData({ formOpen: false });
    this.updateTabBar();
  },

  updateTabBar() {
    this.getTabBar?.()?.setData({ hidden: this.data.formOpen });
  },

  onResize() {
    this.setData({ contentTop: getContentTop() });
  },

  stopPropagation() {},

  onFormDate(event: any) {
    this.setData({ formDate: event.detail.value });
    if (!this.data.editingId && !this.data.endPage) this.selectBook(this.data.formBookId);
  },
  onPages(event: any) { this.setData({ formPages: event.detail.value }); },
  onMinutes(event: any) { this.setData({ formMinutes: event.detail.value }); },
  onStatus(event: any) { this.setData({ formStatusIndex: Number(event.detail.value) }); },

  saveLog() {
    const now = Date.now();
    const existing = this._state?.readingLogs.find((log) => log.id === this.data.editingId);
    const status = STATUS_OPTIONS[this.data.formStatusIndex].value;
    const positioned = this.data.pageMode === "position";
    if (positioned && (!this.data.startPage.trim() || !this.data.endPage.trim())) {
      wx.showToast({ title: "请填写起止页码", icon: "none" });
      return;
    }
    const log: ReadingLog = {
      id: existing?.id || createId("reading"),
      bookId: this.data.formBookId,
      ...(positioned ? { startPage: Number(this.data.startPage), endPage: Number(this.data.endPage) } : {}),
      date: this.data.formDate,
      bookTitle: this.data.formBookTitle,
      pages: positioned ? Number(this.data.endPage) - Number(this.data.startPage) : Number(this.data.formPages),
      minutes: Number(this.data.formMinutes),
      status,
      stickerId: this.data.formStickerId,
      stampIconId: existing?.bookId === this.data.formBookId ? existing.stampIconId : null,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    const result = repository.saveReadingLog(log);
    if (result.error) {
      wx.showToast({ title: result.error, icon: "none" });
      return;
    }
    this.setData({ selectedDate: log.date, formOpen: false });
    this.updateTabBar();
    const selected = dateFromKey(log.date);
    this._cursor = new Date(selected.getFullYear(), selected.getMonth(), 1);
    this.render();
    wx.showToast({ title: existing ? "记录已更新" : "打卡成功", icon: "success" });
  },

  async deleteLog() {
    if (!this.data.editingId) return;
    const result = await wx.showModal({ title: "删除阅读记录", content: "删除后，对应的完成邮票也会自动撤销。", confirmColor: "#a43f32" });
    if (!result.confirm) return;
    await repository.deleteReadingLog(this.data.editingId);
    this.closeForm();
  },

  editGoal() {
    wx.showModal({ title: "本月阅读目标", editable: true, placeholderText: "阅读天数（1–31）", content: String(this.data.monthlyGoal) }).then((result: any) => {
      if (!result.confirm) return;
      repository.setMonthlyReadingGoal(Number(result.content));
    });
  }
});
