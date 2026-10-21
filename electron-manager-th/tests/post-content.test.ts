import { describe, expect, it } from "vitest";
import { mainPostContent } from "../src/shared/post-content";
describe("original post editor isolation", () => {
  it("ignores legacy group content and all follow-up text/media", () => {
    const settings = { caption: "ข้อความหลัก", media: ["main.jpg"], comment: "ความคิดเห็น", shareText: "แชร์",
      mappings: [{ caption: "ข้อความเก่ารายกลุ่ม", media: ["other.jpg"] }], commentTemplates: [{ text: "คอมเมนต์", image: "reply.jpg" }] };
    expect(mainPostContent(settings)).toEqual({ caption: "ข้อความหลัก", media: ["main.jpg"] });
    const result = mainPostContent(settings); result.media.push("changed.jpg");
    expect(settings.media).toEqual(["main.jpg"]);
  });
  it("does not fall back to another account or project when the main editor is empty", () => {
    expect(mainPostContent({ caption: "", media: [] })).toEqual({ caption: "", media: [] });
  });
});
