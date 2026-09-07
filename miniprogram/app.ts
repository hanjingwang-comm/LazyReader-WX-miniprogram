import { CLOUD_ENABLED, CLOUD_ENV_ID } from "./config/runtime";
import { repository } from "./services/repository";

App({
  globalData: {
    repositoryReady: Promise.resolve()
  },

  onLaunch() {
    if (CLOUD_ENABLED && wx.cloud) {
      wx.cloud.init({ env: CLOUD_ENV_ID, traceUser: true });
    }

    this.globalData.repositoryReady = repository.initialize();
    wx.onNetworkStatusChange((status: { isConnected: boolean }) => {
      repository.setOnline(status.isConnected);
      if (status.isConnected) void repository.flushPending();
    });
  }
});
