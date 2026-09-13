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
      title: "为什么它永无止境？",
      tagIds: ["tag-reading", "tag-archive"],
      favorite: true,
      paragraphs: [
        "很难得在网文小说中看到这样质量上乘的作品。我一直在思考书中每个人面对“愤怒”不同的反应和抉择..."
      ]
    },
    {
      id: "sample-method-note",
      folderId: "methods",
      title: "逃走的伸子",
      tagIds: ["tag-method", "tag-writing"],
      favorite: false,
      paragraphs: [
        "你不会读我写的文字，不关心我在意的事情，更不“理会我灵魂的出口”。弟弟好不容易来一趟，丈夫熟视无睹地干活让人感到不自在..."
      ]
    },
    {
      id: "sample-writing-draft",
      folderId: "writing",
      title: "《罗杰疑案》",
      tagIds: ["tag-writing", "tag-draft"],
      favorite: false,
      paragraphs: [
        "谁能想到竟然会在侦探小说里看到上世纪的英国人打麻将..."
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
