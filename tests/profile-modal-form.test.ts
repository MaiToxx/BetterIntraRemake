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

// Other students only get images from the host allowlist; the author sees
// their own regardless, so the editor has to say when a URL is theirs only.
describe("image host hint", () => {
  function hint(value: string): string | null {
    const root = document.createElement("div");
    render(renderUrlField("Image URL", value, () => {}), root);
    return root.querySelector("[data-image-host-hint]")?.textContent?.replace(/\s+/g, " ").trim() ?? null;
  }

  it("names an off-list host, and http", () => {
    expect(hint("https://my-site.example/a.png")).toContain(
      "Only you will see this image: host my-site.example is not on the list",
    );
    expect(hint("http://i.imgur.com/a.png")).toContain("only load https images");
  });

  it("stays silent for an allowlisted https URL, an empty or an unparsable value", () => {
    expect(hint("https://i.imgur.com/a.png")).toBeNull();
    expect(hint("")).toBeNull();
    expect(hint("not a url")).toBeNull();
  });
});
