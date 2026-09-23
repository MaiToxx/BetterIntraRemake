/**
 * @vitest-environment node
 *
 * The Chrome Web Store images (scripts/generate-store-images.js): promo tiles
 * drawn from the icon, not cropped from a screenshot of someone's profile, at
 * the sizes the store asks for, and at most five screenshots cropped to
 * 16:10 without the white letterboxing the old script added.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import {
  MAX_SCREENSHOTS,
  convertScreenshot,
  listScreenshots,
  renderPromoMarquee,
  renderPromoSmall,
} from "../scripts/generate-store-images.js";

const ROOT = path.resolve(__dirname, "..");
let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "store-images-"));
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** A plain red PNG of the given size. */
function redImage(width: number, height: number) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 220, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
}

describe("promo tiles", () => {
  it("are 440x280 and 1400x560 opaque PNGs (the store refuses alpha)", async () => {
    for (const [png, w, h] of [
      [await renderPromoSmall(), 440, 280],
      [await renderPromoMarquee(), 1400, 560],
    ] as const) {
      const meta = await sharp(png).metadata();
      expect(meta.format).toBe("png");
      expect([meta.width, meta.height]).toEqual([w, h]);
      expect(meta.hasAlpha).toBe(false);
    }
  });

  it("are drawn from the icon, not from the upstream screenshots in images/", () => {
    const script = fs.readFileSync(path.join(ROOT, "scripts/generate-store-images.js"), "utf8");
    expect(script).toContain("src/assets/svg/icon.svg");
    // images/intra.png is upstream's author's own 42 profile
    expect(script).not.toMatch(/intra\.png|["'`]\.\.\/images["'`]/);
  });
});

describe("screenshots", () => {
  it("refuses a sixth capture instead of uploading more than the store shows", async () => {
    const dir = fs.mkdtempSync(path.join(tmp, "six-"));
    for (let i = 1; i <= MAX_SCREENSHOTS + 1; i++) {
      fs.writeFileSync(path.join(dir, `${i}.png`), await redImage(16, 10));
    }
    expect(MAX_SCREENSHOTS).toBe(5);
    expect(() => listScreenshots(dir)).toThrow(/at most 5/);
    fs.rmSync(path.join(dir, "6.png"));
    expect(listScreenshots(dir)).toHaveLength(5);
  });

  it("an absent folder means no screenshots, not a crash", () => {
    expect(listScreenshots(path.join(tmp, "missing"))).toEqual([]);
  });

  it("fills 1280x800 edge to edge (fit cover, no white bands) and warns when it had to crop", async () => {
    const src = path.join(tmp, "square.png");
    fs.writeFileSync(src, await redImage(1000, 1000));
    const dst = path.join(tmp, "square-screenshot.png");
    const warning = await convertScreenshot(src, dst);

    const { data, info } = await sharp(dst).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([1280, 800]);
    expect(info.channels).toBe(3);
    // "contain" padded a square source with white on both sides
    const pixel = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return [data[i], data[i + 1], data[i + 2]];
    };
    for (const [x, y] of [[0, 0], [1279, 0], [0, 799], [1279, 799]]) {
      expect(pixel(x, y)).toEqual([220, 0, 0]);
    }
    expect(warning).toMatch(/not 16:10/);

    const exact = path.join(tmp, "exact.png");
    fs.writeFileSync(exact, await redImage(2560, 1600));
    expect(await convertScreenshot(exact, path.join(tmp, "exact-screenshot.png"))).toBeNull();
  });
});
