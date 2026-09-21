/**
 * Formatting helpers shared by the friends widget's row, header and action
 * buttons. They live in a leaf module so the render modules can share them
 * without importing one another.
 */

/** Give a raw SVG asset an explicit size before it goes through unsafeHTML. */
export const svgIcon = (raw: string, size = 16) =>
  raw.replace("<svg", `<svg width="${size}" height="${size}"`);

/** Compact time since a timestamp: "42s ago", "3h 12m ago", "2d 4h ago". */
export function formatTimeAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ${min % 60}m ago`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h ago`;
}
