/**
 * What happens to a picked image before Save: a JPEG over the 2 MB cap is
 * shrunk in the browser (a phone photo used to be refused), and the local
 * preview only ever accepts a plain base64 image data: URL.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "lit-html";
import {
  prepareUpload,
  MAX_UPLOAD_BYTES,
} from "../src/features/profile/header/image-upload.ts";
import {
  localPreviewUrl,
  paintLocalPreview,
  readLocalPreview,
  clearLocalPreview,
} from "../src/features/profile/header/local-preview.ts";
import { renderAvatarEditor } from "../src/features/profile/header/avatar-editor.ts";

const file = (size: number, type: string, name = "photo.jpg") =>
  new File([new Uint8Array(size)], name, { type });

/** createImageBitmap + OffscreenCanvas as a browser has them; `sizes` are the blobs convertToBlob answers in turn. */
function stubCanvas(bitmap: { width: number; height: number }, sizes: number[]) {
  const drawn: number[][] = [];
  const qualities: number[] = [];
  const bitmapOptions: unknown[] = [];
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async (_src: Blob, options?: unknown) => {
      bitmapOptions.push(options);
      return { ...bitmap, close: vi.fn() };
    }),
  );
  let call = 0;
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext() {
        return {
          drawImage: (_b: unknown, x: number, y: number, w: number, h: number) =>
            drawn.push([x, y, w, h]),
        };
      }
      async convertToBlob(opts: { type: string; quality: number }) {
        qualities.push(opts.quality);
        const size = sizes[Math.min(call++, sizes.length - 1)];
        return new Blob([new Uint8Array(size)], { type: opts.type });
      }
    },
  );
  return { drawn, qualities, bitmapOptions };
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearLocalPreview();
});

describe("prepareUpload", () => {
  it("keeps a file under the cap exactly as picked", async () => {
    const f = file(1000, "image/png", "me.png");
    expect(await prepareUpload("avatar", f)).toEqual({ ok: true, blob: f });
  });

  it("shrinks a JPEG over the cap: upright, at most 1024 px for the avatar, under 2 MB", async () => {
    const canvas = stubCanvas({ width: 4000, height: 3000 }, [500_000]);
    const out = await prepareUpload("avatar", file(5 * 1024 * 1024, "image/jpeg"));
    expect(out.ok).toBe(true);
    const blob = (out as { blob: Blob }).blob;
    expect(blob.type).toBe("image/jpeg");
    expect(blob.size).toBeLessThanOrEqual(MAX_UPLOAD_BYTES);
    expect(canvas.drawn[0]).toEqual([0, 0, 1024, 768]);
    expect(canvas.bitmapOptions[0]).toEqual({ imageOrientation: "from-image" });
  });

  it("lets banners keep a screen's width, and lowers the quality until it fits", async () => {
    const canvas = stubCanvas({ width: 6000, height: 2000 }, [
      3 * 1024 * 1024,
      2.5 * 1024 * 1024,
      1024 * 1024,
    ]);
    const out = await prepareUpload("banner", file(8 * 1024 * 1024, "image/jpeg"));
    expect(out.ok).toBe(true);
    expect(canvas.drawn[0]).toEqual([0, 0, 2560, 853]);
    expect(canvas.qualities).toEqual([0.9, 0.8, 0.7]);
  });

  it("refuses a JPEG that stays too big, or when the browser cannot re-encode", async () => {
    stubCanvas({ width: 4000, height: 3000 }, [3 * 1024 * 1024]);
    expect((await prepareUpload("background", file(9 * 1024 * 1024, "image/jpeg"))).ok).toBe(false);
    vi.unstubAllGlobals();
    const out = await prepareUpload("avatar", file(3 * 1024 * 1024, "image/jpeg"));
    expect(out).toEqual({ ok: false, error: expect.stringMatching(/over 2 MB/) });
  });

  it("never re-encodes a PNG, WebP or GIF (transparency, animation): over the cap it is refused", async () => {
    const canvas = stubCanvas({ width: 100, height: 100 }, [10]);
    for (const type of ["image/png", "image/webp", "image/gif"]) {
      expect((await prepareUpload("avatar", file(MAX_UPLOAD_BYTES + 1, type, "x"))).ok).toBe(false);
    }
    expect(canvas.drawn).toHaveLength(0);
  });

  it("refuses a type the worker does not take", async () => {
    expect((await prepareUpload("avatar", file(10, "image/svg+xml", "x.svg"))).ok).toBe(false);
  });
});

describe("local preview", () => {
  it("reads a picked image as a base64 data: URL", async () => {
    const url = await readLocalPreview(new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" }));
    expect(url).toBe("data:image/png;base64,AQID");
  });

  it("accepts only a plain base64 image data: URL", () => {
    expect(localPreviewUrl("data:image/webp;base64,AAAA==")).toBe("data:image/webp;base64,AAAA==");
    for (const bad of [
      'data:image/png;base64,AAAA");position:fixed;x:url("',
      "data:image/svg+xml;base64,AAAA",
      "data:text/html;base64,AAAA",
      "https://img.example/a.png",
      "blob:https://profile.intra.42.fr/1234",
      "",
      42,
    ]) {
      expect(localPreviewUrl(bad)).toBe("");
    }
  });

  it("paints on the page only while there is something to preview, without rewriting an unchanged sheet", () => {
    const url = "data:image/png;base64,AAAA";
    paintLocalPreview({ background: url, backgroundMode: "tile" });
    const sheet = document.getElementById("ft-local-preview-style")!;
    expect(sheet.textContent).toContain(`url("${url}") !important`);
    expect(sheet.textContent).toContain("background-repeat: repeat !important");
    expect(sheet.textContent!.startsWith(":root .w-full")).toBe(true);

    const writes = vi.fn();
    const desc = Object.getOwnPropertyDescriptor(Node.prototype, "textContent")!;
    Object.defineProperty(sheet, "textContent", {
      get: () => desc.get!.call(sheet),
      set: (v) => {
        writes(v);
        desc.set!.call(sheet, v);
      },
      configurable: true,
    });
    paintLocalPreview({ background: url, backgroundMode: "tile" });
    expect(writes).not.toHaveBeenCalled();

    paintLocalPreview({ background: 'x");}*{display:none}' });
    expect(document.getElementById("ft-local-preview-style")).toBeNull();
  });

  it("the avatar editor shows a local preview through a custom property, a hostile one not at all", () => {
    const host = document.createElement("div");
    const draw = (url: string) =>
      render(
        renderAvatarEditor(
          { url, posX: 50, posY: 50, scale: 100, bgColor: "transparent", decoration: "none" },
          () => {},
        ),
        host,
      );
    draw("data:image/jpeg;base64,AAAA");
    const preview = host.querySelector<HTMLElement>("#ft-avatar-preview")!;
    expect(preview.getAttribute("style")).toContain("background-image:var(--ft-avatar-local)");
    expect(preview.parentElement!.getAttribute("style")).toBe(
      '--ft-avatar-local:url("data:image/jpeg;base64,AAAA")',
    );

    draw('data:image/jpeg;base64,AA");position:fixed;x:url("');
    expect(preview.getAttribute("style")).toContain("background-image:none");
    expect(preview.style.position).toBe("");
    expect(preview.parentElement!.getAttribute("style")).toBe("");
  });
});
