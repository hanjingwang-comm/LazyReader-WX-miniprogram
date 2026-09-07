import type { Article, Folder, RepositoryState, Tag, UserSettings } from "./types";
import { SEED_VERSION } from "../config/runtime";

const paragraphDelta = (paragraphs: string[]) => ({
  ops: paragraphs.flatMap((paragraph) => [{ insert: paragraph }, { insert: "\n" }])
});

const paragraphHtml = (paragraphs: string[]) => paragraphs
  .map((paragraph) => `<p>${paragraph}</p>`)
  .join("");

export function createDefaultState(now = Date.now()): RepositoryState {
  const folders: Folder[] = [
    { id: "research", name: "研究材料", parentId: null, sortOrder: 0, createdAt: now, updatedAt: now },
    { id: "methods", name: "方法论", parentId: "research", sortOrder: 0, createdAt: now, updatedAt: now },
    { id: "reading", name: "阅读摘录", parentId: "research", sortOrder: 1, createdAt: now, updatedAt: now },
    { id: "writing", name: "写作素材", parentId: null, sortOrder: 1, createdAt: now, updatedAt: now }
  ];

  const tags: Tag[] = [
    { id: "tag-reading", name: "阅读", colorId: "butter", createdAt: now, updatedAt: now },
    { id: "tag-method", name: "方法", colorId: "sage", createdAt: now, updatedAt: now },
    { id: "tag-writing", name: "写作", colorId: "forest", createdAt: now, updatedAt: now },
    { id: "tag-archive", name: "档案", colorId: "cobalt", createdAt: now, updatedAt: now },
    { id: "tag-draft", name: "草稿", colorId: "stone", createdAt: now, updatedAt: now }
  ];

  const sampleContent = [
    {
      id: "sample-reading-system",
      folderId: "reading",
      title: "阅读系统与长期知识积累",
      tagIds: ["tag-reading", "tag-archive"],
      favorite: true,
      paragraphs: [
        "真正有用的阅读工具，不只是把材料保存下来，而是帮助读者在需要的时候重新找到它、理解它，并继续写下自己的判断。",
        "目录负责建立稳定的位置，标签负责建立跨目录的联系，而编辑器让摘录最终变成属于自己的文字。"
      ]
    },
    {
      id: "sample-method-note",
      folderId: "methods",
      title: "如何整理一份研究备忘",
      tagIds: ["tag-method", "tag-writing"],
      favorite: false,
      paragraphs: [
        "先保留原始材料的上下文，再写下观察、疑问和可验证的解释。不要急着把所有摘录压缩成一个结论。",
        "一份好的研究备忘能够说明证据来自哪里，也能清楚标记仍然没有解决的问题。"
      ]
    },
    {
      id: "sample-writing-draft",
      folderId: "writing",
      title: "把摘录变成自己的表达",
      tagIds: ["tag-writing", "tag-draft"],
      favorite: false,
      paragraphs: [
        "摘录只是入口。重新排序、补充背景、写出反例，再把它放进自己的论证结构里，材料才会真正开始工作。"
      ]
    }
  ];

  const articles: Article[] = sampleContent.map((sample, index) => {
    const contentText = sample.paragraphs.join("\n\n");
    return {
      id: sample.id,
      type: "article",
      title: sample.title,
      excerpt: contentText.slice(0, 140),
      folderId: sample.folderId,
      tagIds: sample.tagIds,
      favorite: sample.favorite,
      contentDelta: paragraphDelta(sample.paragraphs),
      contentHtml: paragraphHtml(sample.paragraphs),
      contentText,
      embeddedAssets: [],
      ocr: { status: "none", fullText: "", highlightedText: "", confidence: null, error: "", updatedAt: null },
      revision: 1,
      createdAt: now - index * 60_000,
      updatedAt: now - index * 60_000
    };
  });

  const settings: UserSettings = {
    id: "settings-local",
    monthlyReadingGoal: 18,
    seedVersion: SEED_VERSION,
    createdAt: now,
    updatedAt: now
  };

  return {
    books: [],
    articles,
    folders,
    tags,
    readingLogs: [],
    settings,
    pendingMutations: [],
    collapsedFolderIds: [],
    syncStatus: "local",
    initialized: true
  };
}

export const TAG_COLORS = {
  butter: { background: "#e5c35b", foreground: "#3d351e", label: "暖黄" },
  forest: { background: "#4f8066", foreground: "#ffffff", label: "林绿" },
  cobalt: { background: "#3f649e", foreground: "#ffffff", label: "靛蓝" },
  mist: { background: "#9cb9c6", foreground: "#25363e", label: "雾蓝" },
  sage: { background: "#a9b9a7", foreground: "#27382f", label: "鼠尾草" },
  stone: { background: "#d8d4ca", foreground: "#46453f", label: "纸灰" }
} as const;
