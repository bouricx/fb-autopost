export function desktopBounds(workArea: { width: number; height: number }) {
  const width = Math.max(1, Math.min(1320, workArea.width));
  const height = Math.max(1, Math.min(860, workArea.height));
  return { width, height, minWidth: Math.min(800, width), minHeight: Math.min(600, height) };
}
