const items = [
  { pagePath: "/pages/library/library", text: "资料库", icon: "/assets/icons/archive.svg" },
  { pagePath: "/pages/checkin/checkin", text: "阅读打卡", icon: "/assets/icons/calendar-days.svg" },
  { pagePath: "/pages/stamps/stamps", text: "书籍邮票", icon: "/assets/icons/stamp.svg" }
];

Component({
  data: {
    selected: 0,
    hidden: false,
    items
  },
  methods: {
    switchTab(this: any, event: any) {
      if (this.data.hidden) return;
      const index = Number(event.currentTarget.dataset.index);
      const item = items[index];
      if (!item || index === this.data.selected) return;
      wx.switchTab({ url: item.pagePath });
    }
  }
});
