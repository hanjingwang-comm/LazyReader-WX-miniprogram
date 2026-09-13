// The atlas artwork crosses the nominal 240px grid; use each illustration's own bounds.
const ARTWORK_BOUNDS = [
  [56, 12, 144, 244], [248, 60, 224, 180], [488, 16, 184, 240],
  [16, 272, 232, 208], [256, 256, 192, 232], [480, 264, 224, 232],
  [48, 480, 160, 232], [232, 520, 224, 188], [488, 496, 192, 216]
] as const;

export function stampArtwork(iconId: number, imageWidth: number, imageHeight: number, size: number) {
  const index = Number.isFinite(iconId) ? Math.max(0, Math.min(8, Math.floor(iconId))) : 0;
  const [x, y, width, height] = ARTWORK_BOUNDS[index];
  const scale = Math.min(size * .52 / width, size * .40 / height);
  return {
    sx: x * imageWidth / 720, sy: y * imageHeight / 720,
    sw: width * imageWidth / 720, sh: height * imageHeight / 720,
    dx: (size - width * scale) / 2, dy: size * .555 - height * scale / 2,
    dw: width * scale, dh: height * scale
  };
}

export function stampTextWidth(size: number, y: number, fontSize: number) {
  const radius = size * .385;
  const distance = Math.abs(y - size / 2) + fontSize * .65;
  return 2 * Math.sqrt(Math.max(0, radius * radius - distance * distance));
}

export function stampTitleLines(title: string, size: number, fontSize: number, measure: (text: string) => number) {
  const text = title.trim() || "已读完";
  const singleY = size * .235;
  if (measure(text) <= stampTextWidth(size, singleY, fontSize)) {
    return [{ text, y: singleY }];
  }
  const remaining = Array.from(text);
  return [size * .205, size * .205 + fontSize * 1.2].map((y, index) => {
    const maxWidth = stampTextWidth(size, y, fontSize);
    let line = "";
    while (remaining.length && measure(line + remaining[0]) <= maxWidth) line += remaining.shift();
    if (index === 1 && remaining.length) {
      const characters = Array.from(line);
      while (characters.length && measure(characters.join("") + "…") > maxWidth) characters.pop();
      line = characters.join("") + "…";
    }
    return { text: line, y };
  });
}
