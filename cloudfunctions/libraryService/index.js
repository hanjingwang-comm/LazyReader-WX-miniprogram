const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const COLLECTIONS = ["articles", "folders", "tags", "books", "reading_logs", "user_settings"];
const ENTITY_COLLECTIONS = new Set(COLLECTIONS);

function stripInternal(doc) {
  if (!doc) return doc;
  const { _id, _openid, ...rest } = doc;
  return rest;
}

function safeEntity(entity) {
  if (!entity || typeof entity !== "object" || Array.isArray(entity)) throw new Error("无效的数据对象");
  const copy = JSON.parse(JSON.stringify(entity));
  delete copy._id;
  delete copy._openid;
  return copy;
}

async function queryAll(collection, openid, extra = {}) {
  const output = [];
  let offset = 0;
  while (true) {
    const result = await db.collection(collection).where({ _openid: openid, ...extra }).skip(offset).limit(100).get();
    output.push(...result.data);
    if (result.data.length < 100) return output;
    offset += result.data.length;
  }
}

async function ownedDocument(collection, id, openid) {
  const result = await db.collection(collection).where({ _id: id, _openid: openid }).limit(1).get();
  return result.data[0] || null;
}

function htmlParagraphs(paragraphs) {
  return paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join("");
}

function deltaParagraphs(paragraphs) {
  return { ops: paragraphs.flatMap((paragraph) => [{ insert: paragraph }, { insert: "\n" }]) };
}

function seedDocuments(openid, now) {
  const prefix = openid.slice(0, 12);
  const folderIds = {
    research: `${prefix}-research`,
    methods: `${prefix}-methods`,
    reading: `${prefix}-reading`,
    writing: `${prefix}-writing`
  };
  const tagIds = {
    reading: `${prefix}-tag-reading`,
    method: `${prefix}-tag-method`,
    writing: `${prefix}-tag-writing`,
    archive: `${prefix}-tag-archive`
  };
  const folders = [
    { id: folderIds.research, name: "研究材料", parentId: null, sortOrder: 0 },
    { id: folderIds.methods, name: "方法论", parentId: folderIds.research, sortOrder: 0 },
    { id: folderIds.reading, name: "阅读摘录", parentId: folderIds.research, sortOrder: 1 },
    { id: folderIds.writing, name: "写作素材", parentId: null, sortOrder: 1 }
  ].map((folder) => ({ ...folder, createdAt: now, updatedAt: now }));
  const tags = [
    { id: tagIds.reading, name: "阅读", colorId: "butter" },
    { id: tagIds.method, name: "方法", colorId: "sage" },
    { id: tagIds.writing, name: "写作", colorId: "forest" },
    { id: tagIds.archive, name: "档案", colorId: "cobalt" }
  ].map((tag) => ({ ...tag, createdAt: now, updatedAt: now }));
  const samples = [
    {
      id: `${prefix}-sample-reading`, folderId: folderIds.reading, title: "阅读系统与长期知识积累",
      tagIds: [tagIds.reading, tagIds.archive], favorite: true,
      paragraphs: [
        "真正有用的阅读工具，不只是把材料保存下来，而是帮助读者在需要的时候重新找到它、理解它，并继续写下自己的判断。",
        "目录负责建立稳定的位置，标签负责建立跨目录的联系，而编辑器让摘录最终变成属于自己的文字。"
      ]
    },
    {
      id: `${prefix}-sample-method`, folderId: folderIds.methods, title: "如何整理一份研究备忘",
      tagIds: [tagIds.method, tagIds.writing], favorite: false,
      paragraphs: [
        "先保留原始材料的上下文，再写下观察、疑问和可验证的解释。不要急着把所有摘录压缩成一个结论。",
        "一份好的研究备忘能够说明证据来自哪里，也能清楚标记仍然没有解决的问题。"
      ]
    }
  ];
  const articles = samples.map((sample, index) => {
    const contentText = sample.paragraphs.join("\n\n");
    return {
      id: sample.id,
      type: "article",
      title: sample.title,
      excerpt: contentText.slice(0, 140),
      folderId: sample.folderId,
      tagIds: sample.tagIds,
      favorite: sample.favorite,
      contentDelta: deltaParagraphs(sample.paragraphs),
      contentHtml: htmlParagraphs(sample.paragraphs),
      contentText,
      embeddedAssets: [],
      ocr: { status: "none", fullText: "", highlightedText: "", confidence: null, error: "", updatedAt: null },
      revision: 1,
      createdAt: now - index * 1000,
      updatedAt: now - index * 1000
    };
  });
  const settings = { id: `${prefix}-settings`, monthlyReadingGoal: 18, seedVersion: 1, createdAt: now, updatedAt: now };
  return { folders, tags, articles, settings };
}

async function insertSeed(openid) {
  const seed = seedDocuments(openid, Date.now());
  for (const folder of seed.folders) await db.collection("folders").doc(folder.id).set({ data: { ...folder, _openid: openid } });
  for (const tag of seed.tags) await db.collection("tags").doc(tag.id).set({ data: { ...tag, _openid: openid } });
  for (const article of seed.articles) await db.collection("articles").doc(article.id).set({ data: { ...article, _openid: openid } });
  await db.collection("user_settings").doc(seed.settings.id).set({ data: { ...seed.settings, _openid: openid } });
}

async function snapshot(openid) {
  const [articles, folders, tags, readingLogs, settings, books] = await Promise.all([
    queryAll("articles", openid),
    queryAll("folders", openid),
    queryAll("tags", openid),
    queryAll("reading_logs", openid),
    queryAll("user_settings", openid),
    queryAll("books", openid)
  ]);
  return {
    books: books.map(stripInternal),
    articles: articles.map(stripInternal),
    folders: folders.map(stripInternal),
    tags: tags.map(stripInternal),
    readingLogs: readingLogs.map(stripInternal),
    settings: stripInternal(settings[0])
  };
}

async function bootstrap(openid) {
  const settings = await queryAll("user_settings", openid);
  if (!settings.length) await insertSeed(openid);
  return { ok: true, openid, snapshot: await snapshot(openid) };
}

async function upsert(openid, event) {
  const collection = event.collection;
  if (!ENTITY_COLLECTIONS.has(collection)) throw new Error("不支持的数据集合");
  const entity = safeEntity(event.entity);
  const id = String(entity.id || "");
  if (!id) throw new Error("数据缺少 id");
  const current = await ownedDocument(collection, id, openid);
  if (current && collection === "articles") {
    const baseRevision = Number(event.baseRevision || 0);
    const remoteRevision = Number(current.revision || 0);
    const sameWrite = Number(entity.revision || 0) === remoteRevision && Number(entity.updatedAt || 0) === Number(current.updatedAt || 0);
    if (baseRevision > 0 && remoteRevision > baseRevision && !sameWrite) {
      return { ok: true, conflict: true, remote: stripInternal(current) };
    }
  }
  if (current && current._openid !== openid) throw new Error("无权修改这条数据");
  await db.collection(collection).doc(id).set({ data: { ...entity, _openid: openid } });
  return { ok: true, entity: stripInternal({ ...entity, _openid: openid }) };
}

function fileIdsForArticle(article) {
  const ids = [];
  if (article?.sourceFile?.fileId) ids.push(article.sourceFile.fileId);
  for (const asset of article?.embeddedAssets || []) if (asset.fileId) ids.push(asset.fileId);
  return ids;
}

async function removeFiles(fileIds) {
  if (!fileIds.length) return;
  for (let offset = 0; offset < fileIds.length; offset += 50) {
    await cloud.deleteFile({ fileList: fileIds.slice(offset, offset + 50) });
  }
}

async function deleteArticle(openid, articleId) {
  const article = await ownedDocument("articles", articleId, openid);
  if (!article) return { ok: true };
  await removeFiles(fileIdsForArticle(article));
  await db.collection("articles").doc(articleId).remove();
  return { ok: true };
}

async function deleteFolder(openid, folderId) {
  const root = await ownedDocument("folders", folderId, openid);
  if (!root) return { ok: true };
  const folders = await queryAll("folders", openid);
  const ids = new Set([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        changed = true;
      }
    }
  }
  const articles = (await queryAll("articles", openid)).filter((article) => ids.has(article.folderId));
  await removeFiles(articles.flatMap(fileIdsForArticle));
  for (const article of articles) await db.collection("articles").doc(article._id).remove();
  for (const id of ids) await db.collection("folders").doc(id).remove();
  return { ok: true, deletedFolders: ids.size, deletedArticles: articles.length };
}

async function deleteEntity(openid, event) {
  const collection = event.collection;
  if (!ENTITY_COLLECTIONS.has(collection) || collection === "articles" || collection === "folders") {
    throw new Error("请使用专用删除操作");
  }
  const entity = await ownedDocument(collection, event.entityId, openid);
  if (entity) await db.collection(collection).doc(event.entityId).remove();
  if (collection === "tags" && entity) {
    const articles = await queryAll("articles", openid);
    for (const article of articles.filter((item) => (item.tagIds || []).includes(event.entityId))) {
      await db.collection("articles").doc(article._id).update({
        data: { tagIds: article.tagIds.filter((id) => id !== event.entityId), updatedAt: Date.now(), revision: Number(article.revision || 0) + 1 }
      });
    }
  }
  return { ok: true };
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, error: "无法确认当前微信用户" };
  try {
    if (event.action === "bootstrap") return await bootstrap(OPENID);
    if (event.action === "upsert") return await upsert(OPENID, event);
    if (event.action === "deleteArticle") return await deleteArticle(OPENID, event.entityId);
    if (event.action === "deleteFolder") return await deleteFolder(OPENID, event.entityId);
    if (event.action === "deleteEntity") return await deleteEntity(OPENID, event);
    return { ok: false, error: "未知操作" };
  } catch (error) {
    console.error("libraryService error", error);
    return { ok: false, error: error.message || "云端资料库处理失败" };
  }
};
