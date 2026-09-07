export function getContentTop(): number {
  const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  const statusHeight = Number(info.statusBarHeight) || 20;
  let capsuleBottom = 0;
  try { capsuleBottom = Number(wx.getMenuButtonBoundingClientRect?.().bottom) || 0; } catch (_error) { /* Use the standard navigation height when unavailable. */ }
  return Math.max(statusHeight + 44, capsuleBottom) + 8;
}

export async function chooseFromList(labels: string[]): Promise<number | null> {
  let offset = 0;
  while (offset < labels.length) {
    const hasMore = labels.length - offset > 6;
    const pageSize = hasMore ? 5 : 6;
    const page = labels.slice(offset, offset + pageSize);
    if (hasMore) page.push(`更多（还剩 ${labels.length - offset - pageSize} 项）`);
    const result = await wx.showActionSheet({ itemList: page }).catch(() => null);
    if (!result) return null;
    if (hasMore && result.tapIndex === page.length - 1) {
      offset += pageSize;
      continue;
    }
    return offset + result.tapIndex;
  }
  return null;
}
