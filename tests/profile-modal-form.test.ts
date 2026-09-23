import { describe, it, expect } from "vitest";
import { render } from "lit-html";
import { renderUrlField } from "../src/features/profile/header/profile-modal-form.ts";

// The URL history thumbnails of the visuals editor. The entries are raw
// strings: typed by the user, but also restored from a backup file or copied
// back from the cloud, so nothing guarantees they are plain URLs.
function thumbnails(history: string[]): HTMLButtonElement[] {
  const root = document.createElement("div");
  render(
    renderUrlField("Image URL", "", () => {}, history, () => {}),
    root,
  );
  return [...root.querySelectorAll<HTMLButtonElement>("button[data-tip]")].filter(
    (b) => b.dataset.tip !== "Clear history",
  );
}

const INJECTION =
  "https://evil.example/a.png);position:fixed!important;left:-100vw!important;" +
  "top:-100vh!important;width:300vw!important;height:300vh!important;" +
  "z-index:2147483647!important;background-image:url(https://evil.example/fake.png";

describe("URL history thumbnails", () => {
  it("a history entry cannot add declarations to the thumbnail's style", () => {
    const [btn] = thumbnails([INJECTION]);
    // The whole value stays inside one quoted url(): no position, no z-index.
    expect(btn.style.position).toBe("");
    expect(btn.style.zIndex).toBe("");
    expect(btn.getAttribute("style")).toContain(`background-image: url("${new URL(INJECTION).href}")`);
    expect(btn.style.width).toBe("2rem");
  });

  it("a URL with parentheses (Wikimedia) keeps its whole path", () => {
    const url = "https://upload.wikimedia.org/wikipedia/commons/a/a9/Example_(cropped).jpg";
    const [btn] = thumbnails([url]);
    expect(btn.getAttribute("style")).toContain(`background-image: url("${url}")`);
  });

  it("an entry that is not an http(s) URL gets no background image", () => {
    const bad = ['x" onmouseover="alert(1)', "javascript:alert(1)", "not a url", ""];
    const btns = thumbnails(bad);
    expect(btns).toHaveLength(bad.length);
    for (const btn of btns) {
      expect(btn.getAttribute("style")).not.toContain("background-image");
      expect(btn.getAttribute("onmouseover")).toBeNull();
      expect(btn.style.width).toBe("2rem");
    }
  });

  it("the tooltip still shows the raw entry, as text", () => {
    const [btn] = thumbnails(["https://img.example/a.png"]);
    expect(btn.dataset.tip).toBe("https://img.example/a.png");
  });
});

