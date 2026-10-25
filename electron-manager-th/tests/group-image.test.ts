import { expect, it } from "vitest";
import { groupImageUrl, mergeDiscoveredGroups } from "../electron/automation/group-image";

it("keeps only Facebook-hosted HTTPS group thumbnails", () => {
  expect(groupImageUrl("https://scontent.fbkk1-1.fna.fbcdn.net/photo.jpg")).toBe("https://scontent.fbkk1-1.fna.fbcdn.net/photo.jpg");
  expect(groupImageUrl("https://www.facebook.com/photo.jpg")).toBe("https://www.facebook.com/photo.jpg");
  expect(groupImageUrl("data:image/svg+xml;base64,abc")).toBeNull();
  expect(groupImageUrl("https://fbcdn.net.evil.example/photo.jpg")).toBeNull();
});

it("retains groups from earlier scrolls and upgrades their late thumbnails", () => {
  const found = new Map();
  const first = { id: "123", name: "กลุ่ม", url: "https://www.facebook.com/groups/123/", imageUrl: null };
  expect(mergeDiscoveredGroups(found, [first])).toBe(true);
  expect(mergeDiscoveredGroups(found, [first])).toBe(false);
  expect(mergeDiscoveredGroups(found, [{ ...first, imageUrl: "https://scontent.fbcdn.net/p.jpg" }])).toBe(true);
  expect(found.get("123")?.imageUrl).toBe("https://scontent.fbcdn.net/p.jpg");
});
