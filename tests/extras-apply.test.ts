import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  applyOwnProfileExtras,
  applyProfileExtras,
  clearProfileExtras,
  extrasAreVisible,
  pickRawExtras,
} from "../src/features/profile/extras/extras-apply";
import {
  EXTRAS_IDENTITY_ID,
  EXTRAS_KEYS,
  EXTRAS_STYLE_ID,
} from "../src/features/profile/extras/extras";
import { CONFIG_DEFAULT, getConfigMany } from "../src/config";
import { sanitizeVisualUrls } from "../src/features/profile/visuals-sanitize";

function header(login = "someone") {
  const card = document.createElement("div");
  card.className = "ft-profile-card";
  const name = document.createElement("h2");
  name.className = "text-2xl";
  name.textContent = "Some One";
  const p = document.createElement("p");
  p.setAttribute("class", "text-sm");
  p.textContent = login;
  card.append(name, p);
  document.body.appendChild(card);
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  (chrome.storage.local.clear as any)();
  (chrome.storage as any).onChanged = { addListener: vi.fn() };
  document.body.replaceChildren();
  document.head.replaceChildren();
  sessionStorage.clear();
  header();
});

afterEach(() => {
  clearProfileExtras();
});

describe("pickRawExtras", () => {
  it("keeps published keys with primitive values only and is idempotent", () => {
    const raw = {
      PROFILE_PUB_BIO: "hello",
      PROFILE_PUB_BANNER_DIM: 40,
      PROFILE_PUB_CARD_GLOW: true,
      PROFILE_PUB_FLAIR: ["x"],
      PROFILE_PUB_GREETING: "x".repeat(600),
      CUSTOM_CSS: "body{}",
      CLOUD_TOKEN: "secret",
    };
    const once = pickRawExtras(raw);
    expect(once).toEqual({
      PROFILE_PUB_BIO: "hello",
      PROFILE_PUB_BANNER_DIM: 40,
      PROFILE_PUB_CARD_GLOW: true,
    });
    expect(pickRawExtras(once)).toEqual(once);
    expect(pickRawExtras(null)).toBeNull();
    expect(pickRawExtras([])).toBeNull();
    expect(pickRawExtras({ CUSTOM_CSS: "x" })).toBeNull();
  });

  it("rides through sanitizeVisualUrls unchanged, twice", () => {
    const base = { avatar: "", banner: "", bannerMode: "fill", background: "", backgroundMode: "fill" };
    const once = sanitizeVisualUrls({ ...base, extras: { PROFILE_PUB_BIO: "hi", NOPE: 1 } });
    expect(once.extras).toEqual({ PROFILE_PUB_BIO: "hi" });
    expect(sanitizeVisualUrls(once).extras).toEqual({ PROFILE_PUB_BIO: "hi" });
    expect(sanitizeVisualUrls({ ...base }).extras).toBeNull();
  });
});

describe("applyProfileExtras (someone else's profile)", () => {
  const raw = {
    PROFILE_PUB_BIO: "I like C",
    PROFILE_PUB_NAME_STYLE: "custom",
    PROFILE_PUB_NAME_COLOR: "#ff0000",
  };

  it("renders the style and the identity block, then clears them", async () => {
    await applyProfileExtras(raw, { login: "someone", own: false });
    expect(document.getElementById(EXTRAS_STYLE_ID)?.textContent).toContain("#ff0000");
    expect(document.getElementById(EXTRAS_IDENTITY_ID)?.textContent).toContain("I like C");

    clearProfileExtras();
    expect(document.getElementById(EXTRAS_STYLE_ID)).toBeNull();
    expect(document.getElementById(EXTRAS_IDENTITY_ID)).toBeNull();
  });

  it("shows nothing when the viewer turned other people's extras off", async () => {
    await chrome.storage.local.set({ PROFILE_SHOW_OTHERS_EXTRAS: false });
    await applyProfileExtras(raw, { login: "someone", own: false });
    expect(document.getElementById(EXTRAS_STYLE_ID)).toBeNull();
    expect(document.getElementById(EXTRAS_IDENTITY_ID)).toBeNull();
  });

  it("shows nothing for an owner who switched publication off or sent garbage", async () => {
    await applyProfileExtras({ ...raw, PROFILE_PUB_ENABLED: false }, { login: "someone", own: false });
    expect(document.getElementById(EXTRAS_IDENTITY_ID)).toBeNull();
    await applyProfileExtras("<script>", { login: "someone", own: false });
    expect(document.getElementById(EXTRAS_STYLE_ID)).toBeNull();
  });

  it("puts the identity block back when the page dropped it (memo hit)", async () => {
    const opts = { login: "someone", own: false };
    await applyProfileExtras(raw, opts);
    document.getElementById(EXTRAS_IDENTITY_ID)!.remove();
    await applyProfileExtras(raw, opts);
    expect(document.getElementById(EXTRAS_IDENTITY_ID)?.textContent).toContain("I like C");
  });

  it("replaces one profile's extras with the next one's", async () => {
    await applyProfileExtras(raw, { login: "someone", own: false });
    await applyProfileExtras({ PROFILE_PUB_BIO: "other bio" }, { login: "other", own: false });
    const block = document.getElementById(EXTRAS_IDENTITY_ID)!;
    expect(block.textContent).toContain("other bio");
    expect(block.textContent).not.toContain("I like C");
    expect(document.getElementById(EXTRAS_STYLE_ID)).toBeNull();
  });
});

describe("applyOwnProfileExtras (my own page)", () => {
  it("reads my settings, ignores the viewer switch and never greets me", async () => {
    await chrome.storage.local.set({
      PROFILE_PUB_BIO: "my bio",
      PROFILE_PUB_GREETING: "welcome",
      PROFILE_SHOW_OTHERS_EXTRAS: false,
    });
    await applyOwnProfileExtras("me42");
    await flush();
    expect(document.getElementById(EXTRAS_IDENTITY_ID)?.textContent).toContain("my bio");
    expect(document.getElementById("ft-egg-toast")).toBeNull();
  });

  it("shows nothing when I have set nothing", async () => {
    await applyOwnProfileExtras("me42");
    expect(document.getElementById(EXTRAS_IDENTITY_ID)).toBeNull();
    expect(document.getElementById(EXTRAS_STYLE_ID)).toBeNull();
  });
});

describe("review fixes", () => {
  it("extrasAreVisible: default values published by every synced user show nothing", () => {
    // syncToCloud pushes the defaults of every PROFILE_PUB_* key, so the
    // worker answers with a non-null `extras` for everyone.
    const defaults: Record<string, unknown> = {};
    for (const key of EXTRAS_KEYS) defaults[key] = CONFIG_DEFAULT[key];
    expect(extrasAreVisible(defaults)).toBe(false);
    expect(extrasAreVisible({ ...defaults, PROFILE_PUB_NAME_COLOR: "#ff0000" })).toBe(false);
    expect(extrasAreVisible({ ...defaults, PROFILE_PUB_BIO: "hi" })).toBe(true);
    expect(extrasAreVisible({ ...defaults, PROFILE_PUB_EFFECT: "snow" })).toBe(true);
    expect(extrasAreVisible(null)).toBe(false);
  });

  it("a bio that looks like JSON survives the config layer", async () => {
    await chrome.storage.local.set({
      PROFILE_PUB_BIO: '["C", "Rust"] and a bit of shell',
      PROFILE_PUB_STATUS_TEXT: "{42}",
      ACTIVE_SCRIPTS: '["logtime","profile"]',
    });
    const c = await getConfigMany(["PROFILE_PUB_BIO", "PROFILE_PUB_STATUS_TEXT", "ACTIVE_SCRIPTS"]);
    expect(c.PROFILE_PUB_BIO).toBe('["C", "Rust"] and a bit of shell');
    expect(c.PROFILE_PUB_STATUS_TEXT).toBe("{42}");
    // keys whose default is an array are still parsed back
    expect(c.ACTIVE_SCRIPTS).toEqual(["logtime", "profile"]);
  });
});
