/**
 * The Profile tab's way into the avatar, banner and background editor. The
 * editor used to open only from a click on my own avatar, which nothing in
 * the hub mentioned: the tab advertised custom images and had no control for
 * them. On my own profile page the button closes the hub and opens the
 * editor through that avatar (whose listener keeps visuals.ts in step with a
 * save); anywhere else it says where to go.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "lit-html";

// the editor itself (a modal that reads a dozen settings) is not under test
const modal = vi.hoisted(() => ({ createSettingsModal: vi.fn(async () => {}) }));
vi.mock("../src/features/profile/header/profile.modal.ts", () => modal);
vi.mock("../src/features/account/account.ts", () => ({
  getCloudLogin: vi.fn(async () => "me"),
  fetchUserVisuals: vi.fn(async () => null),
  logoutCloud: vi.fn(),
}));
// my own public extras, applied by the same pass: another concern
vi.mock("../src/features/profile/extras/extras-apply.ts", () => ({
  applyOwnProfileExtras: vi.fn(async () => {}),
  pickRawExtras: () => null,
}));
import { AVATAR_SELECTOR } from "../src/core/intra/selectors.ts";
import { normalizeSearchText } from "../src/features/hub/hubSettings.data.ts";

beforeEach(async () => {
  vi.resetModules();
  document.body.replaceChildren();
  await chrome.storage.local.clear();
});

async function mount() {
  const { renderAction } = await import("../src/features/hub/controls/actions.ts");
  const { PROFILE_SETTINGS } = await import("../src/features/hub/settings/profile.ts");
  const { settingIds } = await import("../src/features/hub/controls/context.ts");
  const def = PROFILE_SETTINGS.find((d) => d.actionType === "open-visuals-editor")!;
  const host = document.createElement("div");
  document.body.appendChild(host);
  render(renderAction(def), host);
  return {
    def,
    ids: settingIds(def),
    button: host.querySelector("button")!,
    status: host.querySelector<HTMLElement>("[data-visuals-editor-status]")!,
  };
}

/** The Intra avatar; `own`: visuals.ts made it the editor's button. */
function avatar(own: boolean) {
  const el = document.createElement("div");
  el.className = AVATAR_SELECTOR.split(".").filter(Boolean).slice(1).join(" ");
  if (own) el.dataset.modalListener = "true";
  else el.dataset.toggleListener = "true";
  const clicks = vi.fn();
  el.addEventListener("click", clicks);
  document.body.appendChild(el);
  return clicks;
}

function openHub() {
  const dialog = document.createElement("dialog");
  dialog.id = "hub-dialog";
  dialog.setAttribute("open", "");
  const close = vi.fn(() => dialog.removeAttribute("open"));
  dialog.close = close;
  document.body.appendChild(dialog);
  return close;
}

describe("Edit avatar, banner and background", () => {
  it("sits in the Profile tab, and the search finds it by avatar or banner", async () => {
    const { PROFILE_SETTINGS } = await import("../src/features/hub/settings/profile.ts");
    const index = PROFILE_SETTINGS.findIndex((d) => d.actionType === "open-visuals-editor");
    expect(index).toBeGreaterThan(-1);
    // in the Appearance section, before the public profile's divider
    expect(PROFILE_SETTINGS[0]).toMatchObject({ kind: "divider", label: "Appearance" });
    expect(index).toBeLessThan(PROFILE_SETTINGS.findIndex((d) => d.key === "PROFILE_EVENT_TYPE_FILTER"));
    const def = PROFILE_SETTINGS[index]!;
    const searched = normalizeSearchText(`${def.label} ${def.desc}`);
    for (const word of ["avatar", "banner", "background", "click your avatar"]) {
      expect(searched).toContain(word);
    }
  });

  it("is its own button, named by the setting, not the red Reset all data", async () => {
    const { button, ids } = await mount();
    expect(button.textContent!.trim()).toBe("Edit");
    expect(button.classList.contains("btn-error")).toBe(false);
    expect(button.getAttribute("aria-labelledby")).toBe(ids.label);
  });

  it("on my own profile page, closes the hub and opens the editor through my avatar", async () => {
    const clicks = avatar(true);
    const close = openHub();
    const { button, status } = await mount();
    button.click();
    expect(close).toHaveBeenCalledTimes(1);
    expect(clicks).toHaveBeenCalledTimes(1);
    expect(status.classList.contains("hidden")).toBe(true);
  });

  it("anywhere else, says where to go and links my profile", async () => {
    const clicks = avatar(false); // someone else's profile
    const close = openHub();
    const { button, status } = await mount();
    button.click();
    await vi.waitFor(() => expect(status.classList.contains("hidden")).toBe(false));
    expect(status.textContent).toMatch(/your own profile page/);
    expect(status.textContent).toMatch(/click your avatar/);
    // the link asks my profile page to open the editor once it is there
    expect(status.querySelector("a")!.getAttribute("href")).toBe(
      "https://profile-v3.intra.42.fr/#ft-edit-visuals",
    );
    expect(clicks).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("with the Profile feature off, says to turn it on first", async () => {
    await chrome.storage.local.set({ ACTIVE_SCRIPTS: JSON.stringify(["logtime"]) });
    const { button, status } = await mount();
    button.click();
    await vi.waitFor(() => expect(status.classList.contains("hidden")).toBe(false));
    expect(status.textContent).toMatch(/Turn on Profile/);
    expect(status.querySelector("a")).toBeNull();
  });
});

describe("my profile page opened by that link", () => {
  it("opens the editor once, through my avatar, and drops the fragment", async () => {
    history.replaceState({}, "", "/#ft-edit-visuals");
    modal.createSettingsModal.mockClear();
    const el = document.createElement("div");
    el.className = AVATAR_SELECTOR.split(".").filter(Boolean).slice(1).join(" ");
    document.body.appendChild(el);

    const { updateVisuals } = await import("../src/features/profile/header/visuals.ts");
    await updateVisuals();
    await vi.waitFor(() => expect(modal.createSettingsModal).toHaveBeenCalledTimes(1));
    expect(el.dataset.modalListener).toBe("true");
    expect(location.hash).toBe("");
    expect(location.pathname).toBe("/");

    // the next pass (or a reload) does not open it again
    await updateVisuals();
    await new Promise((r) => setTimeout(r, 20));
    expect(modal.createSettingsModal).toHaveBeenCalledTimes(1);
  });

  it("leaves the editor closed on a plain visit", async () => {
    history.replaceState({}, "", "/");
    modal.createSettingsModal.mockClear();
    const el = document.createElement("div");
    el.className = AVATAR_SELECTOR.split(".").filter(Boolean).slice(1).join(" ");
    document.body.appendChild(el);

    const { updateVisuals } = await import("../src/features/profile/header/visuals.ts");
    await updateVisuals();
    await new Promise((r) => setTimeout(r, 20));
    expect(el.dataset.modalListener).toBe("true");
    expect(modal.createSettingsModal).not.toHaveBeenCalled();
  });
});
