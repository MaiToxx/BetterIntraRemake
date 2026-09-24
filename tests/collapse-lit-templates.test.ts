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

  it("collapses the runs of a CRLF file too", () => {
    const src = 'const a = html`<ul>\r\n    <li class="x">${name}</li>\r\n  </ul>`;\r\nconst b = 1;';
    expect(collapseLitTemplates(src, "x.ts")).toBe(
      'const a = html`<ul> <li class="x">${name}</li> </ul>`;\r\nconst b = 1;',
    );
  });

  it("leaves templates whose whitespace is content alone", () => {
    for (const body of [
      "<pre>\n  keep\n</pre>",
      "<textarea>\n  keep\n</textarea>",
      '<p style="white-space: pre-line">\n  keep\n</p>',
      '<p style="white-space:pre-wrap">\n  keep\n</p>',
      "<style>.a { white-space: break-spaces; }</style>\n  <p class=a>keep</p>",
      '<p class="whitespace-pre-line">\n  keep\n</p>',
    ]) {
      expect(collapseLitTemplates("const a = html`" + body + "`;", "x.ts"), body).toBeNull();
    }
  });

  it("still collapses a template whose white-space only says nowrap or normal", () => {
    // The cluster map dialog's <style> says nowrap: skipping on the bare word
    // shipped the whole template indented.
    const src =
      "const a = html`<style>\n  .a { white-space: nowrap; }\n  .b { white-space: normal }\n</style>\n<p>x</p>`;";
    expect(collapseLitTemplates(src, "x.ts")).toBe(
      "const a = html`<style> .a { white-space: nowrap; } .b { white-space: normal } </style> <p>x</p>`;",
    );
  });

  it("drops the comments of a template's <style>, not the rest of its text", () => {
    const src = [
      "const a = html`<style>",
      "  /* why the gap:",
      "     a long note */",
      "  .a { gap: 0/**/1px; }",
      "</style>",
      '<p title="a /* b */">/* shown */</p>`;',
    ].join("\n");
    expect(collapseLitTemplates(src, "x.ts")).toBe(
      'const a = html`<style> .a { gap: 0 1px; } </style> <p title="a /* b */">/* shown */</p>`;',
    );
  });

  it("follows a <style> across a ${} and stops at its end", () => {
    const src = "const a = html`<style>\n  .a { color: ${c}; } /* x */\n</style>/* text */`;";
    expect(collapseLitTemplates(src, "x.ts")).toBe(
      "const a = html`<style> .a { color: ${c}; } </style>/* text */`;",
    );
  });

  it("ships a css block as the plain literal, without comments or indentation", () => {
    const src = [
      'import { css } from "../core/dom/css.ts";',
      "el.textContent = css`",
      "  /* --- card --- */",
      "  #${ID} {",
      "    color: red; /* why */",
      "  }",
      "`;",
    ].join("\n");
    expect(collapseLitTemplates(src, "x.ts")).toBe(
      'import { css } from "../core/dom/css.ts";\nel.textContent = ` #${ID} { color: red; } `;',
    );
  });

  it("the css tag gives, unbuilt, what the untagged literal gives", async () => {
    const { css } = await import("../src/core/dom/css");
    const id = "x";
    const n = 3;
    expect(css`#${id} { z-index: ${n}; }\n`).toBe(`#${id} { z-index: ${n}; }\n`);
    expect(css``).toBe(``);
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
