const cloud = require("wx-server-sdk");
const sharp = require("sharp");
const tencentcloud = require("tencentcloud-sdk-nodejs-ocr");
const { detectMarkedRegions, extractHighlightedText } = require("./ocr-utils");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function textHtml(text) {
  return text.split(/\n{2,}/).map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`).join("");
}

function textDelta(text) {
  return { ops: [{ insert: text }, { insert: "\n" }] };
}

async function ownedArticle(articleId, openid) {
  const result = await db.collection("articles").where({ _id: articleId, _openid: openid }).limit(1).get();
  return result.data[0] || null;
}

function createOcrClient() {
  const secretId = process.env.TENCENTCLOUD_SECRET_ID;
  const secretKey = process.env.TENCENTCLOUD_SECRET_KEY;
  if (!secretId || !secretKey) throw new Error("云函数尚未配置腾讯云 OCR 密钥");
  const Client = tencentcloud.ocr.v20181119.Client;
  return new Client({
    credential: { secretId, secretKey },
    region: process.env.TENCENTCLOUD_REGION || "ap-guangzhou",
    profile: { httpProfile: { endpoint: "ocr.tencentcloudapi.com", reqTimeout: 30 } }
  });
}

async function prepareImage(buffer) {
  const result = await sharp(buffer)
    .rotate()
    .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  const raw = await sharp(result.data).raw().toBuffer({ resolveWithObject: true });
  return {
    encoded: result.data,
    raw: raw.data,
    width: raw.info.width,
    height: raw.info.height,
    channels: raw.info.channels
  };
}

async function markError(article, message) {
  if (!article) return null;
  const now = Date.now();
  const revision = Number(article.revision || 0) + 1;
  await db.collection("articles").doc(article._id).update({
    data: {
      ocr: { ...(article.ocr || {}), status: "error", error: message, updatedAt: now },
      revision,
      updatedAt: now
    }
  });
  return { revision, updatedAt: now };
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  let article = null;
  try {
    if (!OPENID) throw new Error("无法确认当前微信用户");
    article = await ownedArticle(String(event.articleId || ""), OPENID);
    if (!article || article.type !== "image-ocr" || !article.sourceFile?.fileId) {
      throw new Error("找不到可识别的隐藏原图");
    }
    const download = await cloud.downloadFile({ fileID: article.sourceFile.fileId });
    const prepared = await prepareImage(download.fileContent);
    const regions = detectMarkedRegions(prepared.raw, prepared.width, prepared.height, prepared.channels);
    const response = await createOcrClient().GeneralAccurateOCR({ ImageBase64: prepared.encoded.toString("base64") });
    const detections = [...(response.TextDetections || [])].sort((a, b) => {
      const ay = a.ItemPolygon?.Y || a.Polygon?.[0]?.Y || 0;
      const by = b.ItemPolygon?.Y || b.Polygon?.[0]?.Y || 0;
      return ay - by;
    });
    const fullText = detections.map((item) => String(item.DetectedText || "").trim()).filter(Boolean).join("\n");
    const highlightedText = extractHighlightedText(detections, regions);
    const recognized = highlightedText || fullText;
    if (!recognized) throw new Error("图片中没有识别到可编辑文字");
    const confidences = detections.map((item) => Number(item.Confidence)).filter(Number.isFinite);
    const confidence = confidences.length ? Math.round(confidences.reduce((sum, value) => sum + value, 0) / confidences.length) : null;
    const now = Date.now();
    const revision = Number(article.revision || 0) + 1;
    const result = { status: "draft", fullText, highlightedText, confidence };
    await db.collection("articles").doc(article._id).update({
      data: {
        draftContentDelta: textDelta(recognized),
        draftContentHtml: textHtml(recognized),
        draftContentText: recognized,
        ocr: { ...result, error: "", updatedAt: now },
        revision,
        updatedAt: now
      }
    });
    return { ok: true, result, revision, updatedAt: now, markedRegionCount: regions.length };
  } catch (error) {
    const message = error.message || "OCR 识别失败";
    console.error("extractOcr error", error);
    const update = await markError(article, message).catch(() => null);
    return { ok: false, error: message, ...(update || {}) };
  }
};
