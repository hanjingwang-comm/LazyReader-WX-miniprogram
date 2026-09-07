import { earnedBookStamps } from "../../domain/reading";
import { repository } from "../../services/repository";
import { getContentTop } from "../../services/ui";

Page({
  data: {
    statusBarHeight: 20,
    contentTop: 72,
    stamps: [] as ReturnType<typeof earnedBookStamps>
  },
  _unsubscribe: null as null | (() => void),

  async onLoad() {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ statusBarHeight: windowInfo.statusBarHeight || 20, contentTop: getContentTop() });
    await getApp<LazyReaderApp>().globalData.repositoryReady;
    this._unsubscribe = repository.subscribe((state) => {
      this.setData({ stamps: earnedBookStamps(state.readingLogs) });
    });
  },

  onShow() {
    const tabBar = typeof this.getTabBar === "function" ? this.getTabBar() : null;
    if (tabBar) tabBar.setData({ selected: 2, hidden: false });
  },

  onResize() { this.setData({ contentTop: getContentTop() }); },

  onUnload() {
    if (this._unsubscribe) this._unsubscribe();
  },

  openCheckin() {
    wx.switchTab({ url: "/pages/checkin/checkin" });
  },

  openBook(event: any) {
    const id = event.currentTarget.dataset.bookId;
    if (id) wx.navigateTo({ url: `/package-content/pages/book/book?id=${encodeURIComponent(id)}` });
  }
});
