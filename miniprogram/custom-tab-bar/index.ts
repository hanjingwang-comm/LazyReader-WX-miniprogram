const items = [
  { pagePath: "/pages/library/library", text: "书袋", icon: "/assets/icons/archive.svg" },
  { pagePath: "/pages/checkin/checkin", text: "墨迹", icon: "/assets/icons/calendar-days.svg" },
  { pagePath: "/pages/stamps/stamps", text: "墨盒", icon: "/assets/icons/stamp.svg" }
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
