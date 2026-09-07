import { CLOUD_ENABLED, CACHE_KEY, LOCAL_FILE_FOLDER } from "../config/runtime";
import { createDefaultState } from "../domain/defaults";
import {
  createId,
  deriveExcerpt,
  getFolderDescendantIds,
  hasSiblingFolderName,
  nextSortOrder,
  validateFolderMove
} from "../domain/library";
import { iconIdForTitle, migrateReadingBooks, normalizedBookKey, normalizeReadingLog } from "../domain/reading";
import { mergeCollectionWithPending } from "../domain/sync";
import type {
  Article,
  Book,
  ArticleType,
  AssetRef,
  EntityCollection,
  Folder,
  OcrResult,
  PendingMutation,
  ReadingLog,
  RepositoryState,
  SourceFile,
  Tag,
  TagColorId,
  UserSettings
} from "../domain/types";

type Listener = (state: RepositoryState) => void;
type Entity = Article | Book | Folder | Tag | ReadingLog | UserSettings;

interface ImportFile {
  path: string;
  name: string;
  mime: string;
  size: number;
  type: "image" | "pdf";
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_\u4e00-\u9fa5]+/g, "-").slice(-120) || "file";
}

function entityId(entity: Entity): string {
  return entity.id;
}

function cleanCloudEntity<T extends Record<string, unknown>>(entity: T): T {
  const clean = clone(entity);
  delete clean._openid;
  if (clean.sourceFile && typeof clean.sourceFile === "object") {
    delete (clean.sourceFile as Record<string, unknown>).localPath;
  }
  const record = clean as Record<string, unknown>;
  if (Array.isArray(record.embeddedAssets)) {
    record.embeddedAssets = record.embeddedAssets.map((asset) => {
      const next = { ...(asset as Record<string, unknown>) };
      delete next.localPath;
      return next;
    });
  }
  return clean;
}

class LazyReaderRepository {
  private state: RepositoryState = createDefaultState();
  private listeners = new Set<Listener>();
  private initialized = false;
  private online = true;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private userKey = "local";

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    const cached = wx.getStorageSync(CACHE_KEY) as RepositoryState | undefined;
    if (cached && Array.isArray(cached.articles) && Array.isArray(cached.folders)) {
      this.state = {
        ...createDefaultState(),
        ...cached,
        pendingMutations: Array.isArray(cached.pendingMutations) ? cached.pendingMutations : [],
        collapsedFolderIds: Array.isArray(cached.collapsedFolderIds) ? cached.collapsedFolderIds : [],
        initialized: true,
        syncStatus: CLOUD_ENABLED ? "syncing" : "local"
      };
    } else {
      this.state = createDefaultState();
      this.persist();
    }
    this.migrateBooks();
    this.persist();
    this.notify();

    if (!CLOUD_ENABLED) return;
    try {
      const response = await this.callLibraryService({ action: "bootstrap" });
      this.userKey = String(response.openid || "current");
      if (response.snapshot) this.mergeRemoteSnapshot(response.snapshot as Partial<RepositoryState>);
      this.state.syncStatus = this.state.pendingMutations.length ? "pending" : "synced";
      this.persist();
      this.notify();
      await this.flushPending();
    } catch (error) {
      this.state.syncStatus = "pending";
      this.persist();
      this.notify();
      console.warn("Cloud bootstrap failed; using the local cache.", error);
    }
  }

  getState(): RepositoryState {
    return clone(this.state);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  setOnline(online: boolean): void {
    this.online = online;
    if (!online && CLOUD_ENABLED) {
      this.state.syncStatus = "pending";
      this.notify();
    }
  }

  getArticle(articleId: string): Article | undefined {
    const article = this.state.articles.find((item) => item.id === articleId);
    return article ? clone(article) : undefined;
  }

  createArticle(input: Partial<Article> & Pick<Article, "title" | "folderId">): Article {
    const now = Date.now();
    const contentText = input.contentText || "";
    const article: Article = {
      id: input.id || createId("article"),
      type: input.type || "article",
      title: input.title.trim() || "未命名文章",
      bookId: input.bookId || "",
      excerpt: input.excerpt || deriveExcerpt(contentText),
      folderId: input.folderId,
      tagIds: input.tagIds || [],
      favorite: Boolean(input.favorite),
      contentDelta: input.contentDelta || { ops: [{ insert: "\n" }] },
      contentHtml: input.contentHtml || "",
      contentText,
      draftContentDelta: input.draftContentDelta,
      draftContentHtml: input.draftContentHtml,
      draftContentText: input.draftContentText,
      sourceFile: input.sourceFile,
      embeddedAssets: input.embeddedAssets || [],
      ocr: input.ocr || { status: "none", fullText: "", highlightedText: "", confidence: null, error: "", updatedAt: null },
      revision: input.revision || 1,
      createdAt: input.createdAt || now,
      updatedAt: now
    };
    this.state.articles.unshift(article);
    this.enqueue("articles", "upsert", article, 0);
    this.commit("pending");
    return clone(article);
  }

  updateArticle(articleId: string, patch: Partial<Article>, options: { sync?: boolean } = {}): Article | null {
    const index = this.state.articles.findIndex((article) => article.id === articleId);
    if (index < 0) return null;
    const previous = this.state.articles[index];
    const next: Article = {
      ...previous,
      ...clone(patch),
      id: previous.id,
      revision: previous.revision + 1,
      updatedAt: Date.now()
    };
    this.state.articles[index] = next;
    if (options.sync !== false) this.enqueue("articles", "upsert", next, previous.revision);
    this.commit(options.sync === false ? this.state.syncStatus : "pending");
    return clone(next);
  }

  async deleteArticle(articleId: string): Promise<void> {
    this.state.articles = this.state.articles.filter((article) => article.id !== articleId);
    this.removeQueuedMutations("articles", new Set([articleId]));
    this.state.pendingMutations.push({
      id: createId("mutation"), collection: "articles", action: "delete", entityId: articleId,
      baseRevision: 0, queuedAt: Date.now()
    });
    this.commit("pending");
    await this.flushPending();
  }

  toggleFavorite(articleId: string): Article | null {
    const article = this.state.articles.find((item) => item.id === articleId);
    return article ? this.updateArticle(articleId, { favorite: !article.favorite }) : null;
  }

  moveArticle(articleId: string, folderId: string): Article | null {
    if (!this.state.folders.some((folder) => folder.id === folderId)) return null;
    return this.updateArticle(articleId, { folderId });
  }

  createFolder(name: string, parentId: string | null): { folder?: Folder; error?: string } {
    const cleanName = name.trim();
    if (!cleanName) return { error: "请输入文件夹名称" };
    if (parentId && this.state.folders.find((folder) => folder.id === parentId)?.parentId) {
      return { error: "目前只支持一级和二级目录" };
    }
    if (hasSiblingFolderName(this.state.folders, cleanName, parentId)) return { error: "同级目录里已有这个名称" };
    const now = Date.now();
    const folder: Folder = {
      id: createId("folder"), name: cleanName, parentId,
      sortOrder: nextSortOrder(this.state.folders, parentId), createdAt: now, updatedAt: now
    };
    this.state.folders.push(folder);
    this.enqueue("folders", "upsert", folder, 0);
    this.commit("pending");
    return { folder: clone(folder) };
  }

  renameFolder(folderId: string, name: string): { ok: boolean; error?: string } {
    const folder = this.state.folders.find((item) => item.id === folderId);
    const cleanName = name.trim();
    if (!folder || !cleanName) return { ok: false, error: "请输入文件夹名称" };
    if (hasSiblingFolderName(this.state.folders, cleanName, folder.parentId, folderId)) {
      return { ok: false, error: "同级目录里已有这个名称" };
    }
    folder.name = cleanName;
    folder.updatedAt = Date.now();
    this.enqueue("folders", "upsert", folder, 0);
    this.commit("pending");
    return { ok: true };
  }

  moveFolder(folderId: string, parentId: string | null): { ok: boolean; error?: string } {
    const validation = validateFolderMove(this.state.folders, folderId, parentId);
    if (!validation.ok) return { ok: false, error: validation.message };
    const folder = this.state.folders.find((item) => item.id === folderId)!;
    folder.parentId = parentId;
    folder.sortOrder = nextSortOrder(this.state.folders.filter((item) => item.id !== folderId), parentId);
    folder.updatedAt = Date.now();
    this.enqueue("folders", "upsert", folder, 0);
    this.commit("pending");
    return { ok: true };
  }

  reorderFolder(folderId: string, targetFolderId: string): boolean {
    const folder = this.state.folders.find((item) => item.id === folderId);
    const target = this.state.folders.find((item) => item.id === targetFolderId);
    if (!folder || !target || folder.id === target.id || folder.parentId !== target.parentId) return false;
    const siblings = this.state.folders
      .filter((item) => item.parentId === folder.parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const from = siblings.findIndex((item) => item.id === folderId);
    const to = siblings.findIndex((item) => item.id === targetFolderId);
    siblings.splice(to, 0, siblings.splice(from, 1)[0]);
    siblings.forEach((item, index) => {
      item.sortOrder = index;
      item.updatedAt = Date.now();
      this.enqueue("folders", "upsert", item, 0);
    });
    this.commit("pending");
    return true;
  }

  async deleteFolder(folderId: string): Promise<void> {
    const ids = getFolderDescendantIds(this.state.folders, folderId);
    const articleIds = new Set(this.state.articles.filter((article) => ids.has(article.folderId)).map((article) => article.id));
    this.state.folders = this.state.folders.filter((folder) => !ids.has(folder.id));
    this.state.articles = this.state.articles.filter((article) => !articleIds.has(article.id));
    this.state.collapsedFolderIds = this.state.collapsedFolderIds.filter((id) => !ids.has(id));
    this.removeQueuedMutations("folders", ids);
    this.removeQueuedMutations("articles", articleIds);
    this.state.pendingMutations.push({
      id: createId("mutation"), collection: "folders", action: "delete", entityId: folderId,
      baseRevision: 0, payload: { cascade: true }, queuedAt: Date.now()
    });
    this.commit("pending");
    await this.flushPending();
  }

  toggleFolderCollapsed(folderId: string): void {
    const ids = new Set(this.state.collapsedFolderIds);
    if (ids.has(folderId)) ids.delete(folderId); else ids.add(folderId);
    this.state.collapsedFolderIds = Array.from(ids);
    this.commit(this.state.syncStatus, false);
  }

  createTag(name: string, colorId: TagColorId): { tag?: Tag; error?: string } {
    const cleanName = name.trim();
    if (!cleanName) return { error: "请输入标签名称" };
    const existing = this.state.tags.find((tag) => tag.name.toLocaleLowerCase() === cleanName.toLocaleLowerCase());
    if (existing) return { tag: clone(existing) };
    const now = Date.now();
    const tag: Tag = { id: createId("tag"), name: cleanName, colorId, createdAt: now, updatedAt: now };
    this.state.tags.push(tag);
    this.enqueue("tags", "upsert", tag, 0);
    this.commit("pending");
    return { tag: clone(tag) };
  }

  saveBook(input: Pick<Book, "title" | "author" | "totalPages" | "stickerId"> & { id?: string }): { book?: Book; error?: string } {
    const title = input.title.trim();
    if (!title) return { error: "请输入书名" };
    if (!Number.isInteger(input.totalPages) || input.totalPages < 0 || input.totalPages > 99999) return { error: "总页数应为 0–99999 的整数" };
    if (this.state.books.some((book) => book.id !== input.id && normalizedBookKey(book.title) === normalizedBookKey(title))) {
      return { error: "已有同名书籍，请选择已有书籍" };
    }
    const existing = this.state.books.find((book) => book.id === input.id);
    const now = Date.now();
    const book: Book = { id: existing?.id || createId("book"), title, author: input.author.trim(), totalPages: input.totalPages,
      stickerId: Math.min(11, Math.max(0, Math.round(input.stickerId) || 0)),
      stampIconId: existing?.stampIconId ?? iconIdForTitle(title), createdAt: existing?.createdAt || now, updatedAt: now };
    if (existing) this.state.books.splice(this.state.books.indexOf(existing), 1, book);
    else this.state.books.push(book);
    this.enqueue("books", "upsert", book, 0);
    this.state.readingLogs.filter((log) => log.bookId === book.id).forEach((log) => {
      log.bookTitle = book.title;
      log.stickerId = book.stickerId;
      log.updatedAt = now;
      this.enqueue("reading_logs", "upsert", log, 0);
    });
    this.commit("pending");
    return { book: clone(book) };
  }

  saveReadingLog(input: ReadingLog): { log?: ReadingLog; error?: string } {
    const normalized = normalizeReadingLog(input);
    if (!normalized) return { error: "请填写有效日期、书名和页数或时长" };
    const book = this.state.books.find((item) => item.id === input.bookId);
    if (!book) return { error: "请先选择或创建一本书" };
    if (normalized.endPage != null && book.totalPages > 0 && normalized.endPage > book.totalPages) return { error: "当前页码超过本书总页数" };
    normalized.bookTitle = book.title;
    normalized.stickerId = book.stickerId;
    normalized.stampIconId = normalized.stampIconId ?? book.stampIconId;
    const index = this.state.readingLogs.findIndex((log) => log.id === normalized.id);
    const baseRevision = 0;
    if (index >= 0) this.state.readingLogs.splice(index, 1, normalized); else this.state.readingLogs.push(normalized);
    this.enqueue("reading_logs", "upsert", normalized, baseRevision);
    this.commit("pending");
    return { log: clone(normalized) };
  }

  async deleteReadingLog(logId: string): Promise<void> {
    this.state.readingLogs = this.state.readingLogs.filter((log) => log.id !== logId);
    this.enqueueDelete("reading_logs", logId);
    this.commit("pending");
    await this.flushPending();
  }

  setMonthlyReadingGoal(goal: number): void {
    this.state.settings.monthlyReadingGoal = Math.max(1, Math.min(31, Math.round(goal) || 18));
    this.state.settings.updatedAt = Date.now();
    this.enqueue("user_settings", "upsert", this.state.settings, 0);
    this.commit("pending");
  }

  async importAttachment(file: ImportFile, folderId: string): Promise<Article> {
    const articleId = createId(file.type === "image" ? "ocr" : "pdf");
    const stored = await this.storeFile(file.path, file.name, file.mime, file.size, "sources", articleId);
    const sourceFile: SourceFile = { ...stored, hidden: true };
    return this.createArticle({
      id: articleId,
      type: file.type === "image" ? "image-ocr" : "pdf",
      title: file.name.replace(/\.[^.]+$/, "") || file.name,
      folderId,
      sourceFile,
      excerpt: file.type === "image" ? "等待提取并确认文字" : "PDF 原文件已保存，可继续添加正文和标签。",
      ocr: file.type === "image"
        ? { status: "queued", fullText: "", highlightedText: "", confidence: null, error: "", updatedAt: null }
        : { status: "none", fullText: "", highlightedText: "", confidence: null, error: "", updatedAt: null }
    });
  }

  async uploadEmbeddedImage(articleId: string, path: string, name: string, size = 0): Promise<AssetRef> {
    const asset = await this.storeFile(path, name, "image/jpeg", size, "content", articleId);
    const article = this.state.articles.find((item) => item.id === articleId);
    if (article) this.updateArticle(articleId, { embeddedAssets: [...article.embeddedAssets, asset] });
    return asset;
  }

  async usableFilePath(asset: AssetRef): Promise<string> {
    if (asset.localPath) return asset.localPath;
    if (!asset.fileId || !CLOUD_ENABLED) throw new Error("原文件暂时不可用");
    const response = await wx.cloud.getTempFileURL({ fileList: [asset.fileId] });
    const url = response.fileList?.[0]?.tempFileURL;
    if (!url) throw new Error("无法获取原文件地址");
    const download = await wx.downloadFile({ url });
    if (download.statusCode !== 200) throw new Error("原文件下载失败");
    return download.tempFilePath;
  }

  async displayAssetUrl(asset: AssetRef): Promise<string> {
    if (asset.localPath) return asset.localPath;
    if (!asset.fileId || !CLOUD_ENABLED) throw new Error("图片暂时不可用");
    const response = await wx.cloud.getTempFileURL({ fileList: [asset.fileId] });
    const url = response.fileList?.[0]?.tempFileURL;
    if (!url) throw new Error("无法获取图片地址");
    return url;
  }

  async requestOcr(articleId: string): Promise<OcrResult> {
    const article = this.state.articles.find((item) => item.id === articleId);
    if (!article || article.type !== "image-ocr" || !article.sourceFile) {
      throw new Error("当前条目没有可识别图片");
    }
    this.updateArticle(articleId, {
      ocr: { ...article.ocr, status: "processing", error: "", updatedAt: Date.now() }
    });

    if (!CLOUD_ENABLED || !article.sourceFile.fileId) {
      const result: OcrResult = {
        status: "error", fullText: "", highlightedText: "", confidence: null,
        error: "配置 CloudBase 与腾讯云 OCR 后可识别真实图片；当前仍可手动输入并保存。"
      };
      this.applyOcrResult(articleId, result);
      return result;
    }

    await this.flushPending();
    try {
      const call = await wx.cloud.callFunction({ name: "extractOcr", data: { articleId } });
      const payload = (call.result || {}) as Record<string, unknown>;
      if (!payload.ok) {
        const result: OcrResult = {
          status: "error", fullText: "", highlightedText: "", confidence: null,
          error: String(payload.error || "OCR 识别失败")
        };
        this.applyOcrResult(articleId, result, Number(payload.revision || 0), Number(payload.updatedAt || Date.now()));
        return result;
      }
      const result = payload.result as unknown as OcrResult;
      this.applyOcrResult(articleId, result, Number(payload.revision || 0), Number(payload.updatedAt || Date.now()));
      return result;
    } catch (error) {
      const result: OcrResult = {
        status: "error", fullText: "", highlightedText: "", confidence: null,
        error: error instanceof Error ? error.message : "OCR 识别失败"
      };
      this.applyOcrResult(articleId, result);
      return result;
    }
  }

  async flushPending(): Promise<void> {
    if (!CLOUD_ENABLED || !this.online || !this.state.pendingMutations.length) return;
    if (this.state.syncStatus === "syncing") return;
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    this.state.syncStatus = "syncing";
    this.notify();

    while (this.state.pendingMutations.length && this.online) {
      const mutation = this.state.pendingMutations[0];
      try {
        const response = mutation.action === "delete"
          ? await this.callLibraryService({
              action: mutation.collection === "folders" && mutation.payload?.cascade ? "deleteFolder"
                : mutation.collection === "articles" ? "deleteArticle" : "deleteEntity",
              collection: mutation.collection,
              entityId: mutation.entityId
            })
          : await this.callLibraryService({
              action: "upsert",
              collection: mutation.collection,
              entity: mutation.payload,
              baseRevision: mutation.baseRevision
            });

        if (response.conflict && mutation.collection === "articles" && response.remote) {
          this.resolveArticleConflict(mutation, response.remote as Article);
        }
        this.state.pendingMutations.shift();
        this.persist();
      } catch (error) {
        this.state.syncStatus = "pending";
        this.persist();
        this.notify();
        console.warn("Cloud sync paused.", error);
        return;
      }
    }

    this.state.syncStatus = this.state.pendingMutations.length ? "pending" : "synced";
    this.persist();
    this.notify();
  }

  private applyOcrResult(articleId: string, result: OcrResult, remoteRevision = 0, remoteUpdatedAt = Date.now()): void {
    const index = this.state.articles.findIndex((article) => article.id === articleId);
    if (index < 0) return;
    const article = this.state.articles[index];
    const recognized = result.highlightedText.trim() || result.fullText.trim();
    const html = recognized
      ? recognized.split(/\n{2,}/).map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`).join("")
      : article.draftContentHtml || "";
    this.state.articles[index] = {
      ...article,
      draftContentDelta: recognized ? { ops: [{ insert: recognized }, { insert: "\n" }] } : article.draftContentDelta,
      draftContentHtml: html,
      draftContentText: recognized || article.draftContentText || "",
      ocr: {
        status: result.status,
        fullText: result.fullText || "",
        highlightedText: result.highlightedText || "",
        confidence: result.confidence,
        error: result.error || "",
        updatedAt: remoteUpdatedAt
      },
      revision: remoteRevision || article.revision,
      updatedAt: remoteUpdatedAt
    };
    this.commit(result.status === "error" ? "pending" : this.state.syncStatus, false);
  }

  private async storeFile(
    path: string,
    name: string,
    mime: string,
    size: number,
    kind: "sources" | "content",
    articleId: string
  ): Promise<AssetRef> {
    const cleanName = safeFileName(name);
    if (CLOUD_ENABLED) {
      const cloudPath = `users/${this.userKey}/${kind}/${articleId}/${Date.now()}-${cleanName}`;
      const upload = await wx.cloud.uploadFile({ cloudPath, filePath: path });
      return { fileId: upload.fileID, name, mime, size };
    }
    const fs = wx.getFileSystemManager();
    const folder = `${wx.env.USER_DATA_PATH}/${LOCAL_FILE_FOLDER}`;
    try { fs.mkdirSync(folder, true); } catch (_error) { /* Folder already exists. */ }
    const destination = `${folder}/${Date.now()}-${cleanName}`;
    try { fs.copyFileSync(path, destination); } catch (_error) { return { localPath: path, name, mime, size }; }
    return { localPath: destination, name, mime, size };
  }

  private enqueue(collection: EntityCollection, action: "upsert", entity: Entity, baseRevision: number): void {
    const id = entityId(entity);
    const existing = this.state.pendingMutations.find((mutation) => (
      mutation.collection === collection && mutation.entityId === id && mutation.action === "upsert"
    ));
    const payload = cleanCloudEntity(entity as unknown as Record<string, unknown>);
    if (existing) {
      existing.payload = payload;
      existing.queuedAt = Date.now();
    } else {
      this.state.pendingMutations.push({
        id: createId("mutation"), collection, action, entityId: id,
        baseRevision, payload, queuedAt: Date.now()
      });
    }
  }

  private enqueueDelete(collection: EntityCollection, id: string): void {
    this.removeQueuedMutations(collection, new Set([id]));
    this.state.pendingMutations.push({
      id: createId("mutation"), collection, action: "delete", entityId: id,
      baseRevision: 0, queuedAt: Date.now()
    });
  }

  private removeQueuedMutations(collection: EntityCollection, ids: Set<string>): void {
    this.state.pendingMutations = this.state.pendingMutations.filter((mutation) => (
      mutation.collection !== collection || !ids.has(mutation.entityId)
    ));
  }

  private commit(syncStatus: RepositoryState["syncStatus"], schedule = true): void {
    this.state.syncStatus = CLOUD_ENABLED ? syncStatus : "local";
    this.persist();
    this.notify();
    if (schedule && CLOUD_ENABLED) {
      if (this.syncTimer) clearTimeout(this.syncTimer);
      this.syncTimer = setTimeout(() => void this.flushPending(), 2000);
    }
  }

  private persist(): void {
    wx.setStorageSync(CACHE_KEY, this.state);
  }

  private notify(): void {
    const snapshot = this.getState();
    this.listeners.forEach((listener) => listener(snapshot));
  }

  private async callLibraryService(data: Record<string, unknown>): Promise<Record<string, any>> {
    const call = await wx.cloud.callFunction({ name: "libraryService", data });
    const result = (call.result || {}) as Record<string, any>;
    if (!result.ok) throw new Error(String(result.error || "云端资料库调用失败"));
    return result;
  }

  private mergeRemoteSnapshot(remote: Partial<RepositoryState>): void {
    const pending = this.state.pendingMutations;
    this.state.articles = mergeCollectionWithPending("articles", remote.articles || [], this.state.articles, pending);
    this.state.folders = mergeCollectionWithPending("folders", remote.folders || [], this.state.folders, pending);
    this.state.tags = mergeCollectionWithPending("tags", remote.tags || [], this.state.tags, pending);
    this.state.readingLogs = mergeCollectionWithPending("reading_logs", remote.readingLogs || [], this.state.readingLogs, pending);
    this.state.books = mergeCollectionWithPending("books", remote.books || [], this.state.books, pending);
    if (remote.settings) {
      const hasPendingSettings = pending.some((mutation) => mutation.collection === "user_settings" && mutation.action === "upsert");
      if (!hasPendingSettings) this.state.settings = remote.settings;
    }
    this.state.initialized = true;
    this.migrateBooks();
  }

  private migrateBooks(): void {
    const migrated = migrateReadingBooks(Array.isArray(this.state.books) ? this.state.books : [], this.state.readingLogs);
    this.state.books = migrated.books;
    this.state.readingLogs = migrated.logs;
    migrated.addedBooks.forEach((book) => this.enqueue("books", "upsert", book, 0));
    migrated.changedLogs.forEach((log) => this.enqueue("reading_logs", "upsert", log, 0));
  }

  private resolveArticleConflict(mutation: PendingMutation, remote: Article): void {
    const local = this.state.articles.find((article) => article.id === mutation.entityId);
    if (!local) return;
    const conflict: Article = {
      ...clone(local),
      id: createId("conflict"),
      title: `${local.title}（冲突副本）`,
      revision: 1,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.state.articles = this.state.articles.map((article) => article.id === remote.id ? remote : article);
    this.state.articles.unshift(conflict);
    this.enqueue("articles", "upsert", conflict, 0);
  }
}

export const repository = new LazyReaderRepository();
