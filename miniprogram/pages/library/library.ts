import { TAG_COLORS } from "../../domain/defaults";
import { filterArticles, getArticleCountForFolder, visibleTagCount } from "../../domain/library";
import type { Article, Folder, RepositoryState, Tag } from "../../domain/types";
import { repository } from "../../services/repository";
import { chooseFromList, getContentTop } from "../../services/ui";

interface ArticleView extends Article {
  updatedLabel: string;
  displayTags: Array<Tag & { background: string; foreground: string }>;
}

interface FolderView extends Folder {
  count: number;
  selected: boolean;
  collapsed: boolean;
  isLeaf: boolean;
  articles: ArticleView[];
  children: FolderView[];
}

function timeLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function tagView(tag: Tag) {
  const color = TAG_COLORS[tag.colorId];
  return { ...tag, background: color.background, foreground: color.foreground };
}

Page({
  data: {
    statusBarHeight: 20,
    contentTop: 72,
    drawerOpen: false,
    filter: "archive",
    heading: "档案袋",
    query: "",
    selectedTagIds: [] as string[],
    tagsExpanded: false,
    visibleTags: [] as Array<Tag & { background: string; foreground: string; selected: boolean }>,
    hiddenTagCount: 0,
    allTags: [] as Array<Tag & { background: string; foreground: string; selected: boolean }>,
    articles: [] as ArticleView[],
    folders: [] as FolderView[],
    archiveCount: 0,
    favoriteCount: 0,
    syncLabel: "本地保存",
    emptyLabel: "这里还没有内容",
    activeArticleId: ""
  },

  _unsubscribe: null as null | (() => void),
  _state: null as RepositoryState | null,
  _tagLimit: 3,
  _tagAvailableWidth: 250,

  async onLoad() {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ statusBarHeight: windowInfo.statusBarHeight || 20, contentTop: getContentTop() });
    this._tagAvailableWidth = windowInfo.windowWidth * (1 - 56 / 750);
    await getApp<LazyReaderApp>().globalData.repositoryReady;
    this._unsubscribe = repository.subscribe((state) => {
      this._state = state;
      this.renderState();
    });
  },

  onShow() {
    const tabBar = typeof this.getTabBar === "function" ? this.getTabBar() : null;
    if (tabBar) tabBar.setData({ selected: 0, hidden: this.data.drawerOpen });
    if (this._state) this.renderState();
  },

  onUnload() {
    if (this._unsubscribe) this._unsubscribe();
  },

  renderState() {
    const state = this._state;
    if (!state) return;
    const options = {
      filter: this.data.filter,
      tagIds: this.data.selectedTagIds,
      query: this.data.query
    };
    const articles = filterArticles(state.articles, state.folders, state.tags, options);
    const byId = new Map(state.tags.map((tag) => [tag.id, tag]));
    const toArticleView = (article: Article): ArticleView => ({
      ...article,
      updatedLabel: timeLabel(article.updatedAt),
      displayTags: article.tagIds.map((id) => byId.get(id)).filter(Boolean).map((tag) => tagView(tag!))
    });
    const selectedFolderId = this.data.filter.startsWith("folder:") ? this.data.filter.slice(7) : "";
    const articleViews = state.articles.map(toArticleView);
    const buildFolder = (folder: Folder): FolderView => {
      const children = state.folders
        .filter((item) => item.parentId === folder.id)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(buildFolder);
      const collapsed = state.collapsedFolderIds.includes(folder.id);
      return {
        ...folder,
        count: getArticleCountForFolder(state.articles, state.folders, folder.id),
        selected: selectedFolderId === folder.id,
        collapsed,
        isLeaf: children.length === 0,
        articles: children.length || collapsed
          ? []
          : articleViews.filter((article) => article.folderId === folder.id).sort((a, b) => b.updatedAt - a.updatedAt),
        children: collapsed ? [] : children
      };
    };
    const folders = state.folders
      .filter((folder) => !folder.parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(buildFolder);
    const allTags = state.tags.map((tag) => ({
      ...tagView(tag),
      selected: this.data.selectedTagIds.includes(tag.id)
    }));
    this._tagLimit = visibleTagCount(allTags.map((tag) => tag.name), this._tagAvailableWidth);
    const visibleCount = this.data.tagsExpanded ? allTags.length : this._tagLimit;
    const heading = this.data.filter === "archive" ? "档案袋"
      : this.data.filter === "favorite" ? "收藏"
        : state.folders.find((folder) => `folder:${folder.id}` === this.data.filter)?.name || "档案袋";
    const syncLabel = state.syncStatus === "synced" ? "已同步"
      : state.syncStatus === "syncing" ? "同步中"
        : state.syncStatus === "pending" ? "本地已保存，等待同步" : "本地保存";
    this.setData({
      heading,
      articles: articles.map(toArticleView),
      folders,
      archiveCount: state.articles.length,
      favoriteCount: state.articles.filter((article) => article.favorite).length,
      allTags,
      visibleTags: allTags.slice(0, visibleCount),
      hiddenTagCount: Math.max(0, allTags.length - visibleCount),
      syncLabel,
      emptyLabel: this.data.query || this.data.selectedTagIds.length ? "没有匹配的内容" : "这里还没有内容"
    });
  },

  toggleDrawer() {
    this.setData({ drawerOpen: !this.data.drawerOpen });
    this.updateTabBar();
  },

  closeDrawer() {
    this.setData({ drawerOpen: false });
    this.updateTabBar();
  },

  updateTabBar() {
    this.getTabBar?.()?.setData({ hidden: this.data.drawerOpen });
  },

  onResize() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ contentTop: getContentTop() });
    this._tagAvailableWidth = info.windowWidth * (1 - 56 / 750);
    this.renderState();
  },

  onSearch(event: any) {
    this.setData({ query: event.detail.value });
    this.renderState();
  },

  clearSearch() {
    this.setData({ query: "" });
    this.renderState();
  },

  selectSystemFilter(event: any) {
    this.setData({ filter: event.currentTarget.dataset.filter, drawerOpen: false });
    this.updateTabBar();
    this.renderState();
  },

  selectFolder(event: any) {
    const folderId = event.currentTarget.dataset.id;
    repository.toggleFolderCollapsed(folderId);
    this.setData({ filter: `folder:${folderId}` });
    this.renderState();
  },

  toggleTag(event: any) {
    const id = event.currentTarget.dataset.id;
    const selected = new Set(this.data.selectedTagIds);
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    this.setData({ selectedTagIds: Array.from(selected) });
    this.renderState();
  },

  toggleTagsExpanded() {
    this.setData({ tagsExpanded: !this.data.tagsExpanded });
    this.renderState();
  },

  openCreate() {
    const folderId = this.data.filter.startsWith("folder:") ? this.data.filter.slice(7) : "";
    wx.navigateTo({ url: `/package-content/pages/import/import?folderId=${encodeURIComponent(folderId)}` });
  },

  openArticle(event: any) {
    const id = event.currentTarget.dataset.id;
    wx.navigateTo({ url: `/package-content/pages/editor/editor?id=${encodeURIComponent(id)}` });
  },

  async showArticleMenu(event: any) {
    const articleId = event.currentTarget.dataset.id;
    const article = repository.getArticle(articleId);
    if (!article) return;
    const result = await wx.showActionSheet({
      itemList: [article.favorite ? "取消收藏" : "收藏", "移动到目录", "删除"]
    }).catch(() => null);
    if (!result) return;
    if (result.tapIndex === 0) repository.toggleFavorite(articleId);
    if (result.tapIndex === 1) this.chooseArticleFolder(articleId);
    if (result.tapIndex === 2) this.confirmDeleteArticle(articleId, article.title);
  },

  async chooseArticleFolder(articleId: string) {
    const folders = this._state?.folders || [];
    const labels = folders.map((folder) => {
      const parent = folders.find((item) => item.id === folder.parentId);
      return parent ? `${parent.name} / ${folder.name}` : folder.name;
    });
    const index = await chooseFromList(labels);
    if (index == null) return;
    repository.moveArticle(articleId, folders[index].id);
    wx.showToast({ title: "已移动", icon: "success" });
  },

  async confirmDeleteArticle(articleId: string, title: string) {
    const result = await wx.showModal({ title: "删除文章", content: `“${title}”将从资料库中删除。`, confirmColor: "#a43f32" });
    if (result.confirm) await repository.deleteArticle(articleId);
  },

  createRootFolder() {
    this.promptFolderName("新建文件夹", "", (name: string) => {
      const result = repository.createFolder(name, null);
      if (result.error) wx.showToast({ title: result.error, icon: "none" });
    });
  },

  async showFolderMenu(event: any) {
    const folderId = event.currentTarget.dataset.id;
    const folder = this._state?.folders.find((item) => item.id === folderId);
    if (!folder) return;
    const canAddChild = !folder.parentId;
    const labels = canAddChild
      ? ["新建子文件夹", "重命名", "移动或排序", "删除"]
      : ["重命名", "移动或排序", "删除"];
    const result = await wx.showActionSheet({ itemList: labels }).catch(() => null);
    if (!result) return;
    const action = labels[result.tapIndex];
    if (action === "新建子文件夹") this.promptFolderName("新建子文件夹", "", (name: string) => this.finishCreateFolder(name, folder.id));
    if (action === "重命名") this.promptFolderName("重命名", folder.name, (name: string) => {
      const updated = repository.renameFolder(folder.id, name);
      if (!updated.ok) wx.showToast({ title: updated.error, icon: "none" });
    });
    if (action === "移动或排序") this.showMoveFolderMenu(folder.id);
    if (action === "删除") this.confirmDeleteFolder(folder.id, folder.name);
  },

  finishCreateFolder(name: string, parentId: string | null) {
    const result = repository.createFolder(name, parentId);
    if (result.error) wx.showToast({ title: result.error, icon: "none" });
  },

  promptFolderName(title: string, value: string, onConfirm: (value: string) => void) {
    wx.showModal({ title, editable: true, placeholderText: "文件夹名称", content: value }).then((result: any) => {
      if (result.confirm) onConfirm(String(result.content || ""));
    });
  },

  async showMoveFolderMenu(folderId: string) {
    const state = this._state;
    if (!state) return;
    const folder = state.folders.find((item) => item.id === folderId);
    if (!folder) return;
    const roots = state.folders.filter((item) => !item.parentId && item.id !== folderId);
    const siblingIds = state.folders
      .filter((item) => item.parentId === folder.parentId && item.id !== folderId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const actions = ["移到顶层", ...roots.map((item) => `移入 ${item.name}`), ...siblingIds.map((item) => `排到 ${item.name} 前` )];
    const index = await chooseFromList(actions);
    if (index == null) return;
    if (index === 0) {
      const moved = repository.moveFolder(folderId, null);
      if (!moved.ok) wx.showToast({ title: moved.error, icon: "none" });
    } else if (index <= roots.length) {
      const moved = repository.moveFolder(folderId, roots[index - 1].id);
      if (!moved.ok) wx.showToast({ title: moved.error, icon: "none" });
    } else {
      repository.reorderFolder(folderId, siblingIds[index - roots.length - 1].id);
    }
  },

  async confirmDeleteFolder(folderId: string, name: string) {
    const result = await wx.showModal({
      title: "删除文件夹",
      content: `“${name}”及其子目录和文章都会被删除，此操作不可撤销。`,
      confirmColor: "#a43f32"
    });
    if (result.confirm) await repository.deleteFolder(folderId);
  }
});
