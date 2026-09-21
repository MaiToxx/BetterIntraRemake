import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { appendSvg, svgFromMarkup } from "../src/core/dom/svg";

const SRC = path.resolve(__dirname, "../src");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(p));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("no HTML string reaches the DOM", () => {
  it("src never calls innerHTML, outerHTML or insertAdjacentHTML", () => {
    // Project rule (AGENTS.md): lit-html or DOM APIs only. Other users'
    // profile data is rendered on the page, so an HTML sink anywhere is one
    // careless edit away from an injection.
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, "");
        if (/\.(innerHTML|outerHTML)\s*[+]?=|\binsertAdjacentHTML\s*\(/.test(code)) {
          offenders.push(`${path.relative(SRC, file)}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe("svgFromMarkup", () => {
  const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>';

  it("builds an SVG element with the given attributes", () => {
    const svg = svgFromMarkup(ICON, { width: "16", height: "16" });
    expect(svg?.nodeName.toLowerCase()).toBe("svg");
    expect(svg?.getAttribute("width")).toBe("16");
    expect(svg?.querySelector("path")).not.toBeNull();
    expect(svg?.ownerDocument).toBe(document);
  });

  it("returns null for markup that is not a single SVG", () => {
    expect(svgFromMarkup("<div>x</div>")).toBeNull();
    expect(svgFromMarkup("<svg><unclosed></svg")).toBeNull();
    expect(svgFromMarkup("")).toBeNull();
  });

  it("appendSvg appends, and does nothing on invalid markup", () => {
    const host = document.createElement("span");
    appendSvg(host, ICON);
    appendSvg(host, "not svg");
    expect(host.children).toHaveLength(1);
    expect(host.firstElementChild?.nodeName.toLowerCase()).toBe("svg");
  });
});
