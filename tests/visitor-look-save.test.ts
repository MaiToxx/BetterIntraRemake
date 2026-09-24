/**
 * The badge on a profile shown with its owner's published look offers to keep
 * that look as a preset. Reusing a friend's style used to need a theme code
 * sent by them.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/features/customize/customize.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/features/customize/customize.ts")>()),
  applyVisitorLook: vi.fn(async () => {}),
}));
vi.mock("../src/features/profile/extras/extras-apply.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/features/profile/extras/extras-apply.ts")>()),
  applyProfileExtras: vi.fn(async () => {}),
  clearProfileExtras: vi.fn(),
}));

import { pageState, saveVisitorLook, showVisitorLook } from "../src/features/profile/header/visuals-apply.ts";
import { listPresets } from "../src/features/customize/presets.ts";

const LOOK = {
  PROFILE_THEME_PRESET: "dracula",
  CUSTOM_ACCENT_ENABLED: true,
  CUSTOM_ACCENT_COLOR: "#ff79c6",
};

const badge = () => document.getElementById("ft-visitor-look-badge");
const saveButton = () =>
  [...(badge()?.querySelectorAll("button") ?? [])].find((b) => /Save/.test(b.textContent ?? ""));

beforeEach(async () => {
  await chrome.storage.local.clear();
  sessionStorage.clear();
  document.body.replaceChildren();
  showVisitorLook(null);
  pageState.ownLogin = "me";
  pageState.lastUser = "friend";
});

describe("saving a visitor's look", () => {
  it("keeps it as a preset named after them, over my own settings", async () => {
    await chrome.storage.local.set({ CUSTOM_FONT: "mono", CUSTOM_CSS: ".mine{}" });
    await saveVisitorLook("friend", LOOK);
    const [preset] = await listPresets();
    expect(preset.name).toBe("friend's style");
    expect(preset.values).toMatchObject({
      ...LOOK,
      CUSTOM_FONT: "mono",
      CUSTOM_CSS: ".mine{}",
    });
  });

  it("the badge's Save stores it and says where it went", async () => {
    showVisitorLook(LOOK);
    const button = saveButton()!;
    expect(button).toBeDefined();
    button.click();
    await vi.waitFor(async () => expect((await listPresets())[0]?.name).toBe("friend's style"));
    expect(button.textContent).toBe("✓ Saved");
    expect(button.title).toMatch(/Customize > Presets/);
    expect(button.disabled).toBe(true);
  });

  it("no Save when only extras are shown, and no badge on my own page", async () => {
    showVisitorLook(null, { PROFILE_PUB_BIO: "hello" });
    expect(saveButton()).toBeUndefined();
    showVisitorLook(null);
    pageState.lastUser = "me";
    showVisitorLook(LOOK);
    expect(badge()).toBeNull();
  });
});
