import { bookProgress, earnedBookStamps, stickerSrc } from "../../../domain/reading";
import { repository } from "../../../services/repository";
import { getContentTop } from "../../../services/ui";

Page({
  data: {
    statusBarHeight: 20, contentTop: 72, bookId: "", editing: false, title: "", author: "", totalPages: "", stickerId: 0,
    cover: "", stats: { currentPage: 0, percent: 0, days: 0, minutes: 0, pages: 0 },
    articles: [] as Array<{ id: string; title: string }>,
    logs: [] as Array<{ id: string; date: string; label: string }>, finishedDate: "",
    stickers: Array.from({ length: 12 }, (_, id) => ({ id, src: stickerSrc(id) }))
  },
  _unsubscribe: null as null | (() => void),
  _articleId: "",

  async onLoad(options: Record<string, string>) {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this._articleId = options.articleId || "";
    this.setData({ statusBarHeight: info.statusBarHeight || 20, contentTop: getContentTop(), bookId: options.id || "", editing: !options.id });
    await getApp<LazyReaderApp>().globalData.repositoryReady;
    this._unsubscribe = repository.subscribe(() => this.render());
  },
  onUnload() { this._unsubscribe?.(); },
  onResize() { this.setData({ contentTop: getContentTop() }); },
  render() {
    const state = repository.getState();
    const book = state.books.find((item) => item.id === this.data.bookId);
    if (!book || this.data.editing) return;
    this.setData({
      title: book.title, author: book.author, totalPages: book.totalPages ? String(book.totalPages) : "",
      stickerId: book.stickerId, cover: stickerSrc(book.stickerId), stats: bookProgress(book, state.readingLogs),
      articles: state.articles.filter((article) => article.bookId === book.id).map(({ id, title }) => ({ id, title })),
      logs: state.readingLogs.filter((log) => log.bookId === book.id)
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
        .map((log) => ({ id: log.id, date: log.date,
          label: [log.pages ? `${log.pages} 页` : "", log.minutes ? `${log.minutes} 分钟` : "",
            log.status === "finished" ? "已读完" : log.status === "rereading" ? "重读" : "阅读中"].filter(Boolean).join(" · ") })),
      finishedDate: earnedBookStamps(state.readingLogs).find((stamp) => stamp.bookId === book.id)?.date || ""
    });
  },
  goBack() { wx.navigateBack(); },
  editBook() { this.setData({ editing: true }); },
  cancelEdit() {
    if (!this.data.bookId) return this.goBack();
    this.setData({ editing: false });
    this.render();
  },
  onTitle(event: any) { this.setData({ title: event.detail.value }); },
  onAuthor(event: any) { this.setData({ author: event.detail.value }); },
  onTotalPages(event: any) { this.setData({ totalPages: event.detail.value }); },
  chooseSticker(event: any) { this.setData({ stickerId: Number(event.currentTarget.dataset.id) }); },
  saveBook() {
    const result = repository.saveBook({ id: this.data.bookId || undefined, title: this.data.title,
      author: this.data.author, totalPages: Number(this.data.totalPages), stickerId: this.data.stickerId });
    if (!result.book) return wx.showToast({ title: result.error, icon: "none" });
    const wasNew = !this.data.bookId;
    this.setData({ bookId: result.book.id, editing: false });
    if (this._articleId) repository.updateArticle(this._articleId, { bookId: result.book.id });
    this.render();
    if (wasNew) {
      if (!this._articleId) getApp<LazyReaderApp>().globalData.checkinBookId = result.book.id;
      wx.navigateBack();
    } else wx.showToast({ title: "书籍已保存", icon: "success" });
  },
  checkin() {
    getApp<LazyReaderApp>().globalData.checkinBookId = this.data.bookId;
    wx.switchTab({ url: "/pages/checkin/checkin" });
  },
  openArticle(event: any) { wx.navigateTo({ url: `/package-content/pages/editor/editor?id=${encodeURIComponent(event.currentTarget.dataset.id)}` }); },
  addExcerpt() {
    const state = repository.getState();
    const folder = state.folders.find((item) => item.id === "reading") || state.folders[0];
    if (!folder) return wx.showToast({ title: "请先在资料库创建目录", icon: "none" });
    const article = repository.createArticle({ title: "未命名摘录", folderId: folder.id, bookId: this.data.bookId });
    wx.navigateTo({ url: `/package-content/pages/editor/editor?id=${encodeURIComponent(article.id)}` });
  }
});
