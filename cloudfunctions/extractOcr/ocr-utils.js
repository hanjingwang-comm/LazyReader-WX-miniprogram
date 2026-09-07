function lineBox(detection) {
  if (detection.ItemPolygon) {
    const box = detection.ItemPolygon;
    return { x1: box.X, y1: box.Y, x2: box.X + box.Width, y2: box.Y + box.Height };
  }
  const points = detection.Polygon || [];
  if (!points.length) return null;
  const xs = points.map((point) => point.X);
  const ys = points.map((point) => point.Y);
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
}

function overlapsMarkedRegion(box, region) {
  const horizontal = Math.max(0, Math.min(box.x2, region.x2) - Math.max(box.x1, region.x1));
  const width = Math.max(1, box.x2 - box.x1);
  const verticalIntersection = Math.max(0, Math.min(box.y2, region.y2) - Math.max(box.y1, region.y1));
  const nearUnderline = region.y1 >= box.y1 + (box.y2 - box.y1) * 0.45 && region.y1 <= box.y2 + (box.y2 - box.y1) * 0.65;
  return horizontal / width >= 0.18 && (verticalIntersection > 0 || nearUnderline);
}

function extractHighlightedText(detections, regions) {
  if (!regions.length) return "";
  return detections
    .filter((detection) => {
      const box = lineBox(detection);
      return box && regions.some((region) => overlapsMarkedRegion(box, region));
    })
    .map((detection) => String(detection.DetectedText || "").trim())
    .filter(Boolean)
    .join("\n");
}

function groupRuns(runs, width, height) {
  const sorted = [...runs].sort((a, b) => a.y - b.y || a.x1 - b.x1);
  const regions = [];
  for (const run of sorted) {
    const match = regions.find((region) => (
      Math.abs(region.y2 - run.y) <= 8
      && Math.min(region.x2, run.x2) - Math.max(region.x1, run.x1) > -width * 0.03
    ));
    if (match) {
      match.x1 = Math.min(match.x1, run.x1);
      match.x2 = Math.max(match.x2, run.x2);
      match.y2 = run.y + 3;
      match.samples += 1;
    } else {
      regions.push({ x1: run.x1, x2: run.x2, y1: Math.max(0, run.y - 2), y2: Math.min(height, run.y + 3), samples: 1 });
    }
  }
  return regions
    .filter((region) => region.x2 - region.x1 >= width * 0.1)
    .map(({ samples, ...region }) => region);
}

function detectMarkedRegions(raw, width, height, channels) {
  const runs = [];
  const rowStep = Math.max(1, Math.floor(height / 1800));
  const colStep = Math.max(1, Math.floor(width / 1400));
  const minRun = Math.max(14, width * 0.08);
  for (let y = 0; y < height; y += rowStep) {
    let start = -1;
    let lastMarked = -10;
    for (let x = 0; x < width; x += colStep) {
      const index = (y * width + x) * channels;
      const r = raw[index];
      const g = raw[index + 1];
      const b = raw[index + 2];
      const yellow = r > 155 && g > 125 && b < 155 && r - b > 35 && g - b > 18;
      const red = r > 145 && r > g * 1.3 && r > b * 1.22;
      const blue = b > 105 && b > r * 1.22 && b > g * 1.08;
      const ink = r < 72 && g < 72 && b < 72;
      const marked = yellow || red || blue || ink;
      if (marked) {
        if (start < 0) start = x;
        lastMarked = x;
      } else if (start >= 0 && x - lastMarked > colStep * 3) {
        if (lastMarked - start >= minRun) runs.push({ x1: start, x2: lastMarked, y });
        start = -1;
      }
    }
    if (start >= 0 && lastMarked - start >= minRun) runs.push({ x1: start, x2: lastMarked, y });
  }
  return groupRuns(runs, width, height).filter((region) => (region.y2 - region.y1) <= height * 0.12);
}

module.exports = { detectMarkedRegions, extractHighlightedText, lineBox, overlapsMarkedRegion };
