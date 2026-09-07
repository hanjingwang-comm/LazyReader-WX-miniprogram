import { TAG_COLORS } from "../../../domain/defaults";
import { deriveExcerpt } from "../../../domain/library";
import type { Article, EditorDelta, RepositoryState, Tag, TagColorId } from "../../../domain/types";
import { repository } from "../../../services/repository";
import { chooseFromList, getContentTop } from "../../../services/ui";

const TEXT_SIZES = [
  { label: "14", value: "14px" },
  { label: "16", value: "16px" },
  { label: "18", value: "18px" },
  { label: "22", value: "22px" },
  { label: "28", value: "28px" },
  { label: "36", value: "36px" }
];

const BLOCK_STYLES = [
  { label: "正文", value: "" },
  { label: "标题 1", value: "h1" },
  { label: "标题 2", value: "h2" },
  { label: "标题 3", value: "h3" }
];

function viewTag(tag: Tag, selected: boolean) {
  const color = TAG_COLORS[tag.colorId];
  return { ...tag, selected, background: color.background, foreground: color.foreground };
}

Page({
  data: {
    statusBarHeight: 20,
    contentTop: 72,
    articleId: "",
    title: "",
    folderName: "",
    bookId: "",
    bookTitle: "",
    tags: [] as Array<ReturnType<typeof viewTag>>,
    syncLabel: "本地保存",
    favorite: false,
    isPdf: false,
    isOcr: false,
    ocrStatus: "none",
    ocrMessage: "",
    isOcrDraft: false,
    textSizes: TEXT_SIZES,
    sizeIndex: 2,
    blockStyles: BLOCK_STYLES,
    blockIndex: 0,
    formats: {} as Record<string, unknown>,
    editorReady: false,
    importedCount: 0
  },

  _article: null as Article | null,
  _state: null as RepositoryState | null,
  _unsubscribe: null as null | (() => void),
  _editorCtx: null as any,
  _saveTimer: null as ReturnType<typeof setTimeout> | null,
  _pendingEditor: null as null | { delta: EditorDelta; html: string; text: string },
  _lastOcrUpdatedAt: 0,
  _editorHydrated: false,
  _titleDirty: false,

  async onLoad(options: Record<string, string>) {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({
      statusBarHeight: windowInfo.statusBarHeight || 20,
      contentTop: getContentTop(),
      articleId: options.id || "",
      importedCount: Number(options.imported || 0)
    });
    await getApp<LazyReaderApp>().globalData.repositoryReady;
    this._unsubscribe = repository.subscribe((state) => {
      this._state = state;
      this.renderArticle();
    });
  },

  onResize() { this.setData({ contentTop: getContentTop() }); },

  onReady() {
    wx.createSelectorQuery().in(this).select("#article-editor").context((result: any) => {
      this._editorCtx = result.context;
      this.setData({ editorReady: true });
      this.hydrateEditor(true);
    }).exec();
  },

  onHide() {
    this.saveNow(false);
    void repository.flushPending();
  },

  onUnload() {
    this.saveNow(false);
    void repository.flushPending();
    if (this._unsubscribe) this._unsubscribe();
    if (this._saveTimer) clearTimeout(this._saveTimer);
  },

  renderArticle() {
    const state = this._state;
    if (!state) return;
    const article = state.articles.find((item) => item.id === this.data.articleId);
    if (!article) return;
    const previousOcrUpdatedAt = this._lastOcrUpdatedAt;
    this._article = article;
    this._lastOcrUpdatedAt = article.ocr.updatedAt || 0;
    const folderName = state.folders.find((folder) => folder.id === article.folderId)?.name || "未分类";
    const syncLabel = state.syncStatus === "synced" ? "已同步"
      : state.syncStatus === "syncing" ? "正在同步"
        : state.syncStatus === "pending" ? "本地已保存，等待同步" : "本地已保存";
    const isOcrDraft = article.type === "image-ocr" && article.ocr.status !== "confirmed";
    const ocrMessage = article.ocr.status === "queued" ? "等待云端提取画线文字"
      : article.ocr.status === "processing" ? "正在提取画线文字…"
        : article.ocr.status === "draft" ? "文字已进入编辑草稿，请修正后保存"
          : article.ocr.status === "error" ? article.ocr.error || "文字提取失败，可重试或手动录入"
            : "";
    this.setData({
      title: this._titleDirty ? this.data.title : article.title,
      bookId: article.bookId || "",
      bookTitle: state.books.find((book) => book.id === article.bookId)?.title || "",
      folderName,
      tags: state.tags.map((tag) => viewTag(tag, article.tagIds.includes(tag.id))),
      syncLabel,
      favorite: article.favorite,
      isPdf: article.type === "pdf",
      isOcr: article.type === "image-ocr",
      isOcrDraft,
      ocrStatus: article.ocr.status,
      ocrMessage
    });
    if (this._editorCtx && (!this._editorHydrated || (this._lastOcrUpdatedAt > previousOcrUpdatedAt && article.ocr.status === "draft"))) {
      this.hydrateEditor(!this._editorHydrated);
    }
  },

  hydrateEditor(force = false) {
    if (!this._editorCtx || !this._article || (this._pendingEditor && !force)) return;
    const article = this._article;
    const useDraft = article.type === "image-ocr" && article.ocr.status !== "confirmed";
    const delta = useDraft ? article.draftContentDelta : article.contentDelta;
    this._editorCtx.setContents({
      delta: delta || { ops: [{ insert: "\n" }] },
      success: () => { this._editorHydrated = true; }
    });
  },

  goBack() {
    if (this.saveNow(false) === false) return;
    void repository.flushPending();
    wx.navigateBack();
  },

  onTitleInput(event: any) {
    this._titleDirty = true;
    this.setData({ title: event.detail.value, syncLabel: "正在保存…" });
    this.scheduleSave();
  },

  onEditorInput(event: any) {
    this._pendingEditor = {
      delta: event.detail.delta || { ops: [{ insert: "\n" }] },
      html: event.detail.html || "",
      text: event.detail.text || ""
    };
    this.setData({ syncLabel: "正在保存…" });
    this.scheduleSave();
  },

  onStatusChange(event: any) {
    this.setData({ formats: event.detail || {} });
  },

  scheduleSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.saveNow(false), 500);
  },

  saveNow(showToast = true) {
    if (!this._article) return;
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    const title = this.data.title.trim() || "未命名文章";
    const editor = this._pendingEditor;
    if (!editor && !this._titleDirty) {
      if (showToast) wx.showToast({ title: "已保存", icon: "success" });
      return;
    }
    const useDraft = this._article.type === "image-ocr" && this._article.ocr.status !== "confirmed";
    const patch: Partial<Article> = { title };
    if (editor) {
      if (useDraft) {
        patch.draftContentDelta = editor.delta;
        patch.draftContentHtml = editor.html;
        patch.draftContentText = editor.text;
      } else {
        patch.contentDelta = editor.delta;
        patch.contentHtml = editor.html;
        patch.contentText = editor.text;
        patch.excerpt = deriveExcerpt(editor.text);
      }
    }
    let updated: Article | null;
    try {
      updated = repository.updateArticle(this._article.id, patch);
    } catch (_error) {
      this.setData({ syncLabel: "保存失败，请重试" });
      wx.showToast({ title: "本地保存失败，请勿关闭页面", icon: "none" });
      return false;
    }
    if (updated) this._article = updated;
    this._pendingEditor = null;
    this._titleDirty = false;
    if (showToast) wx.showToast({ title: "已保存", icon: "success" });
    return true;
  },

  async manualSave() {
    if (this.saveNow(true) === false) return;
    await repository.flushPending();
  },

  applyFormat(event: any) {
    if (!this._editorCtx) return;
    const { name, value } = event.currentTarget.dataset;
    this._editorCtx.format(name, value || undefined);
  },

  onSizeChange(event: any) {
    const index = Number(event.detail.value);
    this.setData({ sizeIndex: index });
    this._editorCtx?.format("fontSize", TEXT_SIZES[index].value);
  },

  onBlockChange(event: any) {
    const index = Number(event.detail.value);
    this.setData({ blockIndex: index });
    this._editorCtx?.format("header", BLOCK_STYLES[index].value || false);
  },

  async insertImage() {
    if (!this._article || !this._editorCtx) return;
    const result = await wx.chooseMedia({ count: 1, mediaType: ["image"], sourceType: ["album", "camera"] }).catch(() => null);
    if (!result?.tempFiles?.length) return;
    const file = result.tempFiles[0];
    wx.showLoading({ title: "插入图片" });
    try {
      const name = file.tempFilePath.split("/").pop() || `image-${Date.now()}.jpg`;
      const asset = await repository.uploadEmbeddedImage(this._article.id, file.tempFilePath, name, Number(file.size || 0));
      const src = await repository.displayAssetUrl(asset);
      this._editorCtx.insertImage({ src, width: "100%", alt: name });
      wx.hideLoading();
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: error instanceof Error ? error.message : "图片插入失败", icon: "none" });
    }
  },

  async chooseBook() {
    if (!this._article || this.saveNow(false) === false) return;
    const books = repository.getState().books;
    const index = await chooseFromList(["不关联书籍", ...books.map((book) => book.title), "＋ 添加书籍"]);
    if (index == null) return;
    if (index === books.length + 1) {
      wx.navigateTo({ url: `/package-content/pages/book/book?articleId=${encodeURIComponent(this._article.id)}` });
      return;
    }
    repository.updateArticle(this._article.id, { bookId: index === 0 ? "" : books[index - 1].id });
  },

  openBook() {
    if (this.saveNow(false) === false || !this.data.bookId) return;
    wx.navigateTo({ url: `/package-content/pages/book/book?id=${encodeURIComponent(this.data.bookId)}` });
  },

  undo() { this._editorCtx?.undo(); },
  redo() { this._editorCtx?.redo(); },

  async chooseFolder() {
    const state = this._state;
    if (!state || !this._article) return;
    const labels = state.folders.map((folder) => {
      const parent = state.folders.find((item) => item.id === folder.parentId);
      return parent ? `${parent.name} / ${folder.name}` : folder.name;
    });
    const index = await chooseFromList(labels);
    if (index != null) repository.moveArticle(this._article.id, state.folders[index].id);
  },

  toggleTag(event: any) {
    if (!this._article) return;
    const tagId = event.currentTarget.dataset.id;
    const tagIds = new Set<string>(this._article.tagIds as string[]);
    if (tagIds.has(tagId)) tagIds.delete(tagId); else tagIds.add(tagId);
    const updated = repository.updateArticle(this._article.id, { tagIds: Array.from(tagIds) });
    if (updated) this._article = updated;
  },

  async createTag() {
    const nameResult = await wx.showModal({ title: "新建标签", editable: true, placeholderText: "标签名称" });
    const name = String(nameResult.content || "").trim();
    if (!nameResult.confirm || !name) return;
    const colors = Object.entries(TAG_COLORS) as Array<[TagColorId, typeof TAG_COLORS[TagColorId]]>;
    const colorResult = await wx.showActionSheet({ itemList: colors.map(([, value]) => value.label) }).catch(() => null);
    if (!colorResult) return;
    const created = repository.createTag(name, colors[colorResult.tapIndex][0]);
    if (created.error) {
      wx.showToast({ title: created.error, icon: "none" });
      return;
    }
    if (created.tag && this._article && !this._article.tagIds.includes(created.tag.id)) {
      repository.updateArticle(this._article.id, { tagIds: [...this._article.tagIds, created.tag.id] });
    }
  },

  toggleFavorite() {
    if (this._article) repository.toggleFavorite(this._article.id);
  },

  async openPdf() {
    if (!this._article?.sourceFile) return;
    wx.showLoading({ title: "打开原文件" });
    try {
      const path = await repository.usableFilePath(this._article.sourceFile);
      wx.hideLoading();
      await wx.openDocument({ filePath: path, fileType: "pdf", showMenu: true });
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: error instanceof Error ? error.message : "无法打开 PDF", icon: "none" });
    }
  },

  async extractText() {
    if (!this._article || this.data.ocrStatus === "processing") return;
    this.saveNow(false);
    await repository.requestOcr(this._article.id);
  },

  async confirmOcrDraft() {
    if (!this._article) return;
    if (this.saveNow(false) === false) return;
    const article = repository.getArticle(this._article.id);
    if (!article) return;
    const text = article.draftContentText || "";
    if (!text.trim()) {
      wx.showToast({ title: "请先录入或提取文字", icon: "none" });
      return;
    }
    repository.updateArticle(article.id, {
      contentDelta: article.draftContentDelta || { ops: [{ insert: text }, { insert: "\n" }] },
      contentHtml: article.draftContentHtml || `<p>${text}</p>`,
      contentText: text,
      excerpt: deriveExcerpt(text),
      ocr: { ...article.ocr, status: "confirmed", error: "", updatedAt: Date.now() }
    });
    this._pendingEditor = null;
    await repository.flushPending();
    wx.showToast({ title: "修正已保存", icon: "success" });
  },

  async deleteArticle() {
    if (!this._article) return;
    const result = await wx.showModal({ title: "删除文章", content: "此操作不可撤销。", confirmColor: "#a43f32" });
    if (!result.confirm) return;
    await repository.deleteArticle(this._article.id);
    wx.navigateBack();
  }
});
