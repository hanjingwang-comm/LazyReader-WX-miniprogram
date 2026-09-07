import type { Folder } from "../../../domain/types";
import { repository } from "../../../services/repository";
import { chooseFromList, getContentTop } from "../../../services/ui";

interface PendingFile {
  path: string;
  name: string;
  size: number;
  mime: string;
  type: "image" | "pdf";
  sizeLabel: string;
}

function sizeLabel(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

Page({
  data: {
    statusBarHeight: 20,
    contentTop: 72,
    tab: "article",
    title: "",
    folderId: "",
    folderName: "未选择目录",
    folders: [] as Folder[],
    pendingFiles: [] as PendingFile[],
    importing: false
  },

  async onLoad(options: Record<string, string>) {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    await getApp<LazyReaderApp>().globalData.repositoryReady;
    const state = repository.getState();
    const requested = options.folderId && state.folders.find((folder) => folder.id === options.folderId);
    const fallback = state.folders.find((folder) => folder.parentId) || state.folders[0];
    const folder = requested || fallback;
    this.setData({
      statusBarHeight: windowInfo.statusBarHeight || 20,
      contentTop: getContentTop(),
      folders: state.folders,
      folderId: folder?.id || "",
      folderName: folder?.name || "未选择目录"
    });
  },

  onResize() { this.setData({ contentTop: getContentTop() }); },

  goBack() {
    wx.navigateBack();
  },

  setTab(event: any) {
    this.setData({ tab: event.currentTarget.dataset.tab });
  },

  onTitleInput(event: any) {
    this.setData({ title: event.detail.value });
  },

  async chooseFolder() {
    const folders = this.data.folders;
    const labels = folders.map((folder) => {
      const parent = folders.find((item) => item.id === folder.parentId);
      return parent ? `${parent.name} / ${folder.name}` : folder.name;
    });
    const index = await chooseFromList(labels);
    if (index == null) return;
    const folder = folders[index];
    this.setData({ folderId: folder.id, folderName: labels[index] });
  },

  createArticle() {
    if (!this.data.folderId) {
      wx.showToast({ title: "请先创建一个目录", icon: "none" });
      return;
    }
    const article = repository.createArticle({
      title: this.data.title.trim() || "未命名文章",
      folderId: this.data.folderId
    });
    wx.redirectTo({ url: `/package-content/pages/editor/editor?id=${encodeURIComponent(article.id)}&new=1` });
  },

  async chooseImages() {
    const result = await wx.chooseMedia({
      count: 9,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      sizeType: ["compressed", "original"]
    }).catch(() => null);
    if (!result) return;
    const files = result.tempFiles.map((file: any, index: number): PendingFile => {
      const name = file.originalFileObj?.name || file.tempFilePath.split("/").pop() || `图片-${Date.now()}-${index + 1}.jpg`;
      return {
        path: file.tempFilePath,
        name,
        size: Number(file.size || 0),
        mime: file.fileType === "image" ? "image/jpeg" : "image/jpeg",
        type: "image",
        sizeLabel: sizeLabel(Number(file.size || 0))
      };
    });
    this.setData({ pendingFiles: [...this.data.pendingFiles, ...files] });
  },

  async choosePdfs() {
    const result = await wx.chooseMessageFile({ count: 9, type: "file", extension: ["pdf"] }).catch(() => null);
    if (!result) return;
    const files = result.tempFiles
      .filter((file: any) => /\.pdf$/i.test(file.name))
      .map((file: any): PendingFile => ({
        path: file.path,
        name: file.name,
        size: Number(file.size || 0),
        mime: "application/pdf",
        type: "pdf",
        sizeLabel: sizeLabel(Number(file.size || 0))
      }));
    this.setData({ pendingFiles: [...this.data.pendingFiles, ...files] });
  },

  removePending(event: any) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ pendingFiles: this.data.pendingFiles.filter((_item: PendingFile, itemIndex: number) => itemIndex !== index) });
  },

  async importFiles() {
    if (!this.data.pendingFiles.length || this.data.importing) return;
    if (!this.data.folderId) {
      wx.showToast({ title: "请先创建一个目录", icon: "none" });
      return;
    }
    this.setData({ importing: true });
    wx.showLoading({ title: "正在导入", mask: true });
    try {
      const articles = [];
      for (const file of this.data.pendingFiles) {
        articles.push(await repository.importAttachment(file, this.data.folderId));
      }
      const imageArticles = articles.filter((article) => article.type === "image-ocr");
      imageArticles.forEach((article) => void repository.requestOcr(article.id));
      wx.hideLoading();
      wx.redirectTo({
        url: `/package-content/pages/editor/editor?id=${encodeURIComponent(articles[0].id)}&imported=${articles.length}`
      });
    } catch (error) {
      wx.hideLoading();
      this.setData({ importing: false });
      wx.showToast({ title: error instanceof Error ? error.message : "导入失败", icon: "none" });
    }
  }
});
