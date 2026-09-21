/**
 * The avatar editor's preview writes the URL and background colour being
 * edited into a style attribute: a value that ends the url("...") string or
 * the declaration must not add declarations of its own.
 */
import { describe, it, expect } from "vitest";
import { render } from "lit-html";
import { renderAvatarEditor } from "../src/features/profile/header/avatar-editor";

function preview(url: string, bgColor: string): HTMLElement {
  const host = document.createElement("div");
  render(
    renderAvatarEditor(
      { url, bgColor, posX: 50, posY: 50, scale: 100, decoration: "none" },
      () => {},
    ),
    host,
  );
  return host.querySelector<HTMLElement>("#ft-avatar-preview")!;
}

describe("avatar editor preview", () => {
  it("keeps a hostile URL inside one quoted url()", () => {
    const el = preview('https://x.test/a.png");position:fixed;z-index:99;x:url("', "#123456");
    expect(el.style.position).toBe("");
    expect(el.style.zIndex).toBe("");
    expect(el.style.backgroundImage.startsWith('url("https://x.test/')).toBe(true);
  });

  it("drops a URL that is not http(s)", () => {
    expect(preview("javascript:alert(1)", "#123456").style.backgroundImage).toBe("none");
  });

  it("keeps real URLs with parentheses", () => {
    const url = "https://upload.wikimedia.org/a/b/Cat_(cropped).jpg";
    expect(preview(url, "transparent").style.backgroundImage).toBe(`url("${url}")`);
  });

  it("refuses a colour that carries declarations", () => {
    const el = preview("", "red;position:fixed");
    expect(el.style.position).toBe("");
    expect(el.style.backgroundColor).toBe("transparent");
    expect(preview("", "#00babc").style.backgroundColor).toBe("rgb(0, 186, 188)");
  });
});
