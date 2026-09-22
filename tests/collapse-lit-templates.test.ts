import { describe, it, expect } from "vitest";
import { render, html } from "lit-html";
import { collapseLitTemplates } from "../scripts/collapse-lit-templates";

describe("collapse-lit-templates build plugin", () => {
  it("collapses newline runs inside html`` quasis only", () => {
    const src = [
      "const a = html`<ul>",
      "    <li class=\"x\">${name}</li>",
      "    <li>b</li>",
      "  </ul>`;",
      "const css = `.a {",
      "  color: red;",
      "}`;",
    ].join("\n");
    const out = collapseLitTemplates(src, "x.ts")!;
    expect(out).toContain('html`<ul> <li class="x">${name}</li> <li>b</li> </ul>`');
    expect(out).toContain("const css = `.a {\n  color: red;\n}`;");
  });

  it("leaves templates whose whitespace is content alone", () => {
    const src = "const a = html`<pre>\n  keep\n</pre>`;";
    expect(collapseLitTemplates(src, "x.ts")).toBeNull();
  });

  it("returns null when there is nothing to change", () => {
    expect(collapseLitTemplates("const a = html`<b>x</b>`;", "x.ts")).toBeNull();
    expect(collapseLitTemplates("const a = 1;", "x.ts")).toBeNull();
  });

  it("renders the same DOM before and after", () => {
    const before = html`<div>
        <span>${"a"}</span>
        <span>b</span>
      </div>`;
    const after = html`<div> <span>${"a"}</span> <span>b</span> </div>`;
    const h1 = document.createElement("div");
    const h2 = document.createElement("div");
    render(before, h1);
    render(after, h2);
    expect(h1.textContent!.replace(/\s+/g, " ").trim()).toBe(h2.textContent!.replace(/\s+/g, " ").trim());
    expect(h1.querySelectorAll("span").length).toBe(2);
    expect(h2.querySelectorAll("span").length).toBe(2);
  });
});
