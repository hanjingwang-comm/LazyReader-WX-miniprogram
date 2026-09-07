import test from "node:test";
import assert from "node:assert/strict";
import utils from "../cloudfunctions/extractOcr/ocr-utils.js";

const { detectMarkedRegions, extractHighlightedText, overlapsMarkedRegion } = utils;

test("OCR line-region intersection accepts a highlight and a nearby underline", () => {
  const line = { x1: 10, y1: 20, x2: 110, y2: 40 };
  assert.equal(overlapsMarkedRegion(line, { x1: 15, y1: 25, x2: 95, y2: 34 }), true);
  assert.equal(overlapsMarkedRegion(line, { x1: 20, y1: 43, x2: 90, y2: 45 }), true);
  assert.equal(overlapsMarkedRegion(line, { x1: 120, y1: 20, x2: 160, y2: 30 }), false);
});

test("highlighted extraction preserves OCR line order", () => {
  const detections = [
    { DetectedText: "第一行", ItemPolygon: { X: 10, Y: 10, Width: 100, Height: 20 } },
    { DetectedText: "第二行", ItemPolygon: { X: 10, Y: 50, Width: 100, Height: 20 } }
  ];
  assert.equal(extractHighlightedText(detections, [{ x1: 5, y1: 8, x2: 115, y2: 35 }]), "第一行");
});

test("marked-region detector finds a long colored underline", () => {
  const width = 120;
  const height = 60;
  const channels = 3;
  const raw = Buffer.alloc(width * height * channels, 255);
  for (let x = 15; x < 105; x += 1) {
    const index = (42 * width + x) * channels;
    raw[index] = 30;
    raw[index + 1] = 70;
    raw[index + 2] = 190;
  }
  const regions = detectMarkedRegions(raw, width, height, channels);
  assert.equal(regions.length > 0, true);
  assert.equal(regions.some((region) => region.x1 <= 16 && region.x2 >= 100), true);
});
