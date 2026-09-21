/**
 * The lazy boundaries of the split content script (docs/CODE-SPLITTING.md):
 * the cluster map dialog, the profile editor, the particle effects, the
 * easter egg effects (and the hacker preset), the calendar QR code and the
 * hub. For each one: nothing is imported before first use, the first use
 * imports the chunk and calls into it, and a chunk that cannot be loaded (a
 * tab left open across an extension update gets a 404) fails quietly, with no
 * exception or unhandled rejection reaching the page. The chunks are mocked
 * with vi.doMock; a factory that throws stands for the failed load.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render } from "lit-html";

const MAP_DIALOG = "../src/features/clusters/map-dialog.ts";
const PROFILE_MODAL = "../src/features/profile/header/profile.modal.ts";
const EXTRAS_EFFECTS = "../src/features/profile/extras/extras-effects.ts";
const EGGS_EFFECTS = "../src/features/eggs/eggs-effects.ts";
const PRESETS = "../src/features/customize/presets.ts";
const QR = "../src/features/calendar/qr.ts";
const HUB_UI = "../src/features/hub/hubSettings.ui.ts";

const MOCKED = [MAP_DIALOG, PROFILE_MODAL, EXTRAS_EFFECTS, EGGS_EFFECTS, PRESETS, QR, HUB_UI];

const failedLoad = () => {
  throw new Error("404: chunk not found");
};

/** Let the mocked import() and the promise chains after it settle. */
async function settle(): Promise<void> {
  await vi.dynamicImportSettled();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  vi.resetModules();
  (chrome.storage as unknown as Record<string, unknown>).onChanged = {
    addListener: vi.fn(),
    removeListener: vi.fn(),
  };
  await chrome.storage.local.clear();
  document.head.replaceChildren();
  document.body.replaceChildren();
  sessionStorage.clear();
  localStorage.clear();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  for (const id of MOCKED) vi.doUnmock(id);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.dispatchEvent(new Event("pagehide"));
});

describe("cluster map dialog (open-map.ts)", () => {
  it("is imported on the first open, with the seat, and not before", async () => {
    const open = vi.fn(async () => {});
    const factory = vi.fn(() => ({ openClusterDialog: open }));
    vi.doMock(MAP_DIALOG, factory);
    const { openClusterDialog } = await import("../src/features/clusters/open-map.ts");
    expect(factory).not.toHaveBeenCalled();

    await openClusterDialog({ seatId: "c1r2s3" });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith({ seatId: "c1r2s3" });

    // Later opens reuse the loaded module: a double click reaches the one
    // module instance twice, and map-dialog.ts's own `opening` guard merges
    // them there.
    await openClusterDialog();
    await openClusterDialog();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(3);
    expect(warn).not.toHaveBeenCalled();
  });

  it("fails quietly when the chunk cannot be loaded", async () => {
    vi.doMock(MAP_DIALOG, failedLoad);
    const { openClusterDialog } = await import("../src/features/clusters/open-map.ts");
    await expect(openClusterDialog({ seatId: "c1r2s3" })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "Better Intra: the cluster map could not be opened.",
      expect.anything(),
    );
  });

  it("fails quietly when the dialog itself throws", async () => {
    vi.doMock(MAP_DIALOG, () => ({
      openClusterDialog: async () => {
        throw new Error("boom");
      },
    }));
    const { openClusterDialog } = await import("../src/features/clusters/open-map.ts");
    await expect(openClusterDialog()).resolves.toBeUndefined();
  });
});

describe("profile editor (avatar-clicks.ts)", () => {
  function ownAvatar(onSave = vi.fn()) {
    const avatar = document.createElement("div");
    avatar.className = "rounded-full w-52 h-52";
    document.body.appendChild(avatar);
    return { avatar, onSave };
  }

  it("is imported on the first click, and a double click opens one editor", async () => {
    let finish!: () => void;
    const create = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const factory = vi.fn(() => ({ createSettingsModal: create }));
    vi.doMock(PROFILE_MODAL, factory);
    const { attachEditorListener } = await import("../src/features/profile/header/avatar-clicks.ts");
    const { avatar, onSave } = ownAvatar();
    attachEditorListener(avatar, onSave);
    expect(factory).not.toHaveBeenCalled();

    avatar.click();
    avatar.click(); // while the chunk loads
    await settle();
    avatar.click(); // while the editor builds itself
    await settle();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(onSave);

    finish();
    await settle();
    avatar.click(); // opened and closed: a new click opens it again
    await settle();
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("fails quietly when the chunk cannot be loaded, and lets the next click retry", async () => {
    vi.doMock(PROFILE_MODAL, failedLoad);
    const { attachEditorListener } = await import("../src/features/profile/header/avatar-clicks.ts");
    const { avatar, onSave } = ownAvatar();
    attachEditorListener(avatar, onSave);
    avatar.click();
    await settle();
    expect(warn).toHaveBeenCalledWith(
      "Better Intra: the profile editor could not be opened.",
      expect.anything(),
    );
    avatar.click();
    await settle();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("particle effects (extras-apply.ts)", () => {
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

  function effectsMock() {
    const startEffect = vi.fn();
    const stopEffect = vi.fn();
    return { startEffect, stopEffect, isEffectRunning: () => false };
  }

  const snowy = { PROFILE_PUB_BIO: "hi", PROFILE_PUB_EFFECT: "snow", PROFILE_PUB_EFFECT_INTENSITY: "high" };
  const opts = { login: "someone", own: false };

  it("is imported on the first effect, not for a profile without one", async () => {
    const mod = effectsMock();
    const factory = vi.fn(() => mod);
    vi.doMock(EXTRAS_EFFECTS, factory);
    header();
    const extras = await import("../src/features/profile/extras/extras-apply.ts");

    await extras.applyProfileExtras({ PROFILE_PUB_BIO: "no effect" }, opts);
    await settle();
    expect(factory).not.toHaveBeenCalled();

    await extras.applyProfileExtras(snowy, opts);
    await settle();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(mod.startEffect).toHaveBeenCalledWith("snow", "high", "");

    // Loaded: stops are synchronous from now on.
    extras.clearProfileExtras();
    expect(mod.stopEffect).toHaveBeenCalled();
  });

  it("is not imported for a viewer who prefers reduced motion", async () => {
    const factory = vi.fn(effectsMock);
    vi.doMock(EXTRAS_EFFECTS, factory);
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") }));
    header();
    const extras = await import("../src/features/profile/extras/extras-apply.ts");
    await extras.applyProfileExtras(snowy, opts);
    await settle();
    expect(factory).not.toHaveBeenCalled();
  });

  it("a stop issued while the chunk loads cancels the pending start", async () => {
    const mod = effectsMock();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.doMock(EXTRAS_EFFECTS, async () => {
      await gate;
      return mod;
    });
    header();
    const extras = await import("../src/features/profile/extras/extras-apply.ts");
    await extras.applyProfileExtras(snowy, opts);
    // The visitor leaves the profile before the chunk is there.
    extras.clearProfileExtras();
    release();
    await settle();
    expect(mod.startEffect).not.toHaveBeenCalled();
    expect(document.querySelector("canvas")).toBeNull();
  });

  it("fails quietly: the rest of the extras still show", async () => {
    vi.doMock(EXTRAS_EFFECTS, failedLoad);
    header();
    const extras = await import("../src/features/profile/extras/extras-apply.ts");
    const { EXTRAS_IDENTITY_ID } = await import("../src/features/profile/extras/extras.ts");
    await expect(extras.applyProfileExtras(snowy, opts)).resolves.toBeUndefined();
    await settle();
    expect(warn).toHaveBeenCalledWith(
      "Better Intra: the profile effect could not be loaded.",
      expect.anything(),
    );
    expect(document.getElementById(EXTRAS_IDENTITY_ID)?.textContent).toContain("hi");
    expect(() => extras.clearProfileExtras()).not.toThrow();
  });
});

describe("easter egg effects (eggs.ts)", () => {
  function eggEffectsMock() {
    return {
      confetti: vi.fn(),
      partyMode: vi.fn(),
      barrelRoll: vi.fn(),
      matrixRain: vi.fn(),
      maxwell: vi.fn(),
      maxwellInvasion: vi.fn(),
    };
  }

  const type = (word: string) => {
    for (const key of word) document.dispatchEvent(new KeyboardEvent("keydown", { key }));
  };

  it("are imported on the first effect, and the wrappers pass their arguments", async () => {
    const mod = eggEffectsMock();
    const factory = vi.fn(() => mod);
    vi.doMock(EGGS_EFFECTS, factory);
    const eggs = await import("../src/features/eggs/eggs.ts");
    await eggs.initEasterEggs();
    expect(factory).not.toHaveBeenCalled();

    await eggs.matrixRain(3);
    await eggs.maxwellInvasion(5, 10);
    await eggs.partyMode();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(mod.matrixRain).toHaveBeenCalledWith(3);
    expect(mod.maxwellInvasion).toHaveBeenCalledWith(5, 10);
    expect(mod.partyMode).toHaveBeenCalledWith(undefined);

    type("barrel");
    await settle();
    expect(mod.barrelRoll).toHaveBeenCalledTimes(1);
    expect(document.getElementById("ft-egg-toast")?.textContent).toContain("barrel roll");
  });

  it("fail quietly: the secret is still found and toasted", async () => {
    vi.doMock(EGGS_EFFECTS, failedLoad);
    const eggs = await import("../src/features/eggs/eggs.ts");
    await eggs.initEasterEggs();
    await expect(eggs.confetti()).resolves.toBeUndefined();
    type("matrix");
    await settle();
    expect(warn).toHaveBeenCalledWith(
      "Better Intra: the easter egg effects could not be loaded.",
      expect.anything(),
    );
    expect(await eggs.listFoundEggs()).toEqual(["matrix"]);
    expect(document.getElementById("ft-egg-toast")?.textContent).toContain("spoon");
  });

  it("the 7th fast gear click imports the presets, saves the hacker preset and rains", async () => {
    const mod = eggEffectsMock();
    vi.doMock(EGGS_EFFECTS, () => mod);
    const savePreset = vi.fn(async () => {});
    const presets = vi.fn(() => ({ savePreset }));
    vi.doMock(PRESETS, presets);
    const eggs = await import("../src/features/eggs/eggs.ts");
    for (let i = 0; i < 6; i++) await eggs.gearClicked();
    expect(presets).not.toHaveBeenCalled();
    await eggs.gearClicked();
    await settle();
    expect(savePreset).toHaveBeenCalledWith("🐇 Hacker", expect.objectContaining({ CUSTOM_FONT: "mono" }));
    expect(mod.matrixRain).toHaveBeenCalledWith(4);
    expect(await eggs.listFoundEggs()).toEqual(["hacker"]);
  });

  it("the hacker preset fails quietly when the presets chunk cannot be loaded", async () => {
    vi.doMock(PRESETS, failedLoad);
    const eggs = await import("../src/features/eggs/eggs.ts");
    for (let i = 0; i < 6; i++) await eggs.gearClicked();
    await expect(eggs.gearClicked()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "Better Intra: the hacker preset could not be loaded.",
      expect.anything(),
    );
    expect(await eggs.listFoundEggs()).toEqual([]);
  });
});

describe("calendar QR code (calendar.ui.ts)", () => {
  async function panel() {
    const { renderCalendarPanel } = await import("../src/features/calendar/calendar.ui.ts");
    const host = document.createElement("div");
    document.body.appendChild(host);
    render(renderCalendarPanel(), host);
    await settle();
    await settle();
    return host;
  }

  it("imports qrcode-generator only when there is a token", async () => {
    const generateQrDataUrl = vi.fn(() => "data:image/png;base64,QR");
    const factory = vi.fn(() => ({ generateQrDataUrl }));
    vi.doMock(QR, factory);

    let host = await panel();
    expect(factory).not.toHaveBeenCalled();
    expect(host.querySelector('img[alt="QR Code"]')).toBeNull();
    expect(host.textContent).toContain("Generate calendar link");

    host.remove();
    await chrome.storage.local.set({ CALENDAR_SYNC_TOKEN: "tok-123" });
    host = await panel();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(generateQrDataUrl).toHaveBeenCalledWith(expect.stringContaining("/calendar/tok-123.ics"), 200);
    expect(host.querySelector<HTMLImageElement>('img[alt="QR Code"]')?.getAttribute("src")).toBe(
      "data:image/png;base64,QR",
    );
  });

  it("fails quietly: the link is there, the picture is not", async () => {
    vi.doMock(QR, failedLoad);
    await chrome.storage.local.set({ CALENDAR_SYNC_TOKEN: "tok-123" });
    const host = await panel();
    expect(warn).toHaveBeenCalledWith(
      "Better Intra: the calendar QR code could not be drawn.",
      expect.anything(),
    );
    expect(host.querySelector("code")?.textContent).toContain("/calendar/tok-123.ics");
    expect(host.querySelector('img[alt="QR Code"]')).toBeNull();
  });
});

describe("settings hub (hubSettings.ts)", () => {
  function sidebar() {
    const group = document.createElement("div");
    group.className = "flex flex-col w-full";
    document.body.appendChild(group);
    return group;
  }

  it("is imported when the gear is clicked", async () => {
    const openHubModal = vi.fn(async () => {});
    const factory = vi.fn(() => ({ openHubModal }));
    vi.doMock(HUB_UI, factory);
    sidebar();
    const { mountGearButton } = await import("../src/features/hub/hubSettings.ts");
    mountGearButton();
    await settle();
    expect(factory).not.toHaveBeenCalled();
    document.getElementById("hub-gear-btn")!.click();
    await settle();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(openHubModal).toHaveBeenCalledTimes(1);
  });

  it("fails quietly when the chunk cannot be loaded", async () => {
    vi.doMock(HUB_UI, failedLoad);
    sidebar();
    const { mountGearButton } = await import("../src/features/hub/hubSettings.ts");
    mountGearButton();
    await settle();
    document.getElementById("hub-gear-btn")!.click();
    await settle();
    expect(warn).toHaveBeenCalledWith(
      "Better Intra: the settings hub could not be opened.",
      expect.anything(),
    );
  });
});
