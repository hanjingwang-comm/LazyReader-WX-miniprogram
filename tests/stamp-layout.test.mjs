import test from "node:test";
import assert from "node:assert/strict";
import { stampArtwork, stampTextWidth, stampTitleLines } from "../miniprogram/domain/stamp-layout.ts";

test("stamp titles stay within the inner ring and preserve the four demo book names", () => {
  for (const size of [128, 150, 180, 240, 320]) {
    const fontSize = Math.max(10, size * .06);
    const measure = (text) => Array.from(text).length * fontSize;
    for (const title of ["无论如何，潜水", "亲爱的安德烈", "葡萄成熟时", "献给阿尔吉侬的花束"]) {
      const lines = stampTitleLines(title, size, fontSize, measure);
      assert.equal(lines.map((line) => line.text).join(""), title);
      for (const line of lines) {
        assert.ok(measure(line.text) <= stampTextWidth(size, line.y, fontSize));
        assert.ok(line.y + fontSize * .65 < size * .355);
      }
    }
    const long = stampTitleLines("很长的书名".repeat(20), size, fontSize, measure);
    assert.equal(long.length, 2);
    assert.ok(long[1].text.endsWith("…"));
    assert.equal(stampTitleLines(" ", size, fontSize, measure)[0].text, "已读完");
  }
});

test("artwork uses individual atlas bounds without the neighbouring row's fragments", () => {
  for (let id = 0; id < 9; id++) {
    const box = stampArtwork(id, 720, 720, 180);
    assert.ok(box.sx >= 0 && box.sy >= 0 && box.sx + box.sw <= 720 && box.sy + box.sh <= 720);
    assert.ok(box.dy >= 180 * .355 - .001);
    assert.ok(box.dy + box.dh <= 180 * .755 + .001);
    assert.ok(Math.abs(box.dw / box.dh - box.sw / box.sh) < .0001);
  }
  assert.ok(stampArtwork(0, 720, 720, 180).sy + stampArtwork(0, 720, 720, 180).sh > 240);
  assert.equal(stampArtwork(8, 720, 720, 180).sy, 496);
  assert.equal(stampArtwork(4, 720, 720, 180).sx, 256);
});
