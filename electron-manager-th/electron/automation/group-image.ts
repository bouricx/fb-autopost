/** Accept image URLs from the group card only; never expose cookies or arbitrary protocols to the renderer. */
export function groupImageUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, "https://www.facebook.com/");
    if (url.protocol !== "https:" || !/(^|\.)(facebook\.com|fbcdn\.net)$/.test(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

export function mergeDiscoveredGroups(found: Map<string, import("../../src/shared/types").FacebookGroupInfo>, groups: import("../../src/shared/types").FacebookGroupInfo[]): boolean {
  let changed = false;
  for (const group of groups) {
    const sanitized = { ...group, imageUrl: groupImageUrl(group.imageUrl) };
    const previous = found.get(group.id);
    if (!previous || (!previous.imageUrl && sanitized.imageUrl)) {
      found.set(group.id, sanitized);
      changed = true;
    }
  }
  return changed;
}
