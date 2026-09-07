import type { Article, Folder, Tag } from "./types";

export function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

export function visibleTagCount(names: string[], availableWidth: number): number {
  // Match the fixed-size chips and reserve the entire overflow button hit area.
  const widths = names.map((name) => Math.min(105, 22 + Array.from(name).reduce(
    (sum, character) => sum + (/^[\x00-\x7F]$/.test(character) ? 7 : 12), 0
  )));
  const total = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, widths.length - 1) * 6;
  if (total <= availableWidth) return names.length;
  let used = 44;
  let count = 0;
  for (const width of widths) {
    if (used + 6 + width > availableWidth) break;
    used += 6 + width;
    count += 1;
  }
  return count;
}

export function getFolderDescendantIds(folders: Folder[], folderId: string): Set<string> {
  const ids = new Set<string>([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    folders.forEach((folder) => {
      if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        changed = true;
      }
    });
  }
  return ids;
}

export function getArticleCountForFolder(articles: Article[], folders: Folder[], folderId: string): number {
  const descendantIds = getFolderDescendantIds(folders, folderId);
  return articles.filter((article) => descendantIds.has(article.folderId)).length;
}

export function validateFolderMove(folders: Folder[], folderId: string, parentId: string | null): { ok: boolean; message: string } {
  const folder = folders.find((item) => item.id === folderId);
  if (!folder) return { ok: false, message: "找不到这个文件夹" };
  if ((folder.parentId || null) === (parentId || null)) return { ok: false, message: "文件夹已经位于这里" };
  if (!parentId) return { ok: true, message: "" };

  const parent = folders.find((item) => item.id === parentId);
  if (!parent) return { ok: false, message: "目标目录不存在" };
  if (parent.id === folderId || getFolderDescendantIds(folders, folderId).has(parent.id)) {
    return { ok: false, message: "不能把文件夹移到自身内部" };
  }
  if (parent.parentId) return { ok: false, message: "目前只支持一级和二级目录" };
  if (folders.some((item) => item.parentId === folderId)) {
    return { ok: false, message: "含有子文件夹的目录需保留在一级" };
  }
  return { ok: true, message: "" };
}

export function hasSiblingFolderName(folders: Folder[], name: string, parentId: string | null, excludeId?: string): boolean {
  const key = name.trim().toLocaleLowerCase();
  return folders.some((folder) => (
    folder.id !== excludeId
    && (folder.parentId || null) === (parentId || null)
    && folder.name.trim().toLocaleLowerCase() === key
  ));
}

export function filterArticles(
  articles: Article[],
  folders: Folder[],
  tags: Tag[],
  options: { filter: string; tagIds: string[]; query: string }
): Article[] {
  const query = options.query.trim().toLocaleLowerCase();
  const folderId = options.filter.startsWith("folder:") ? options.filter.slice(7) : null;
  const folderIds = folderId ? getFolderDescendantIds(folders, folderId) : null;
  const tagNames = new Map(tags.map((tag) => [tag.id, tag.name]));

  return articles
    .filter((article) => {
      if (options.filter === "favorite" && !article.favorite) return false;
      if (folderIds && !folderIds.has(article.folderId)) return false;
      if (!options.tagIds.every((tagId) => article.tagIds.includes(tagId))) return false;
      if (!query) return true;
      const searchable = [
        article.title,
        article.excerpt,
        article.contentText,
        ...article.tagIds.map((tagId) => tagNames.get(tagId) || "")
      ].join(" ").toLocaleLowerCase();
      return searchable.includes(query);
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deriveExcerpt(text: string, fallback = "尚未添加正文"): string {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, 140) : fallback;
}

export function nextSortOrder(folders: Folder[], parentId: string | null): number {
  const siblings = folders.filter((folder) => (folder.parentId || null) === (parentId || null));
  return siblings.length ? Math.max(...siblings.map((folder) => folder.sortOrder)) + 1 : 0;
}
