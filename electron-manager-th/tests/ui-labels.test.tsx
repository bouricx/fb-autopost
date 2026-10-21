import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Time24Picker } from "../src/components/Time24Picker";
import { ProjectToolbar } from "../src/components/ProjectToolbar";
import { workspaceSchema } from "../electron/projects/project-manager";

describe("clear workspace controls", () => {
  it("renders 24-hour selections without AM/PM", () => {
    const html = renderToStaticMarkup(<Time24Picker value="16:05" onChange={vi.fn()}/>);
    expect(html).toContain('value="16" selected=""');
    expect(html).toContain('value="05" selected=""');
    expect(html).toContain("ชั่วโมง (00 ถึง 23)");
    expect(html).not.toContain("AM"); expect(html).not.toContain("PM");
  });
  it("names project actions explicitly and prevents implicit form submission", () => {
    const html = renderToStaticMarkup(<ProjectToolbar settings={workspaceSchema.parse({})} load={vi.fn()}/>);
    expect(html).toContain("ทำสำเนาโปรเจกต์"); expect(html).toContain("ส่งออกโปรเจกต์");
    expect(html.match(/<button /g)?.length).toBe(html.match(/type="button"/g)?.length);
  });
});
