/**
 * The hub's one-click destructive actions ask first, and say what goes: a
 * tab's Reset (on Shortcuts it deleted every typed link, and Auto push then
 * replaced the cloud copy), removing a shortcut that holds something, Reset
 * all data (which also signs out). The shortcut editor must also follow a
 * Reset (it kept drawing the deleted links, and the next keystroke saved
 * them back), store a move (a reorder used to be drawn and never saved),
 * and keep a half-typed row through Add.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "lit-html";

const account = vi.hoisted(() => ({
  clearAuthFailed: vi.fn(async () => {}),
  loginWith42: vi.fn(async () => {}),
  logoutCloud: vi.fn(async () => true),
  pushSettings: vi.fn(async () => "ok"),
  syncToCloud: vi.fn(async () => true),
}));
vi.mock("../src/features/account/account.ts", () => account);

import {
  bindTabPanels,
  renderTabsContent,
  resetConfirmMessage,
} from "../src/features/hub/controls/tab-panel.ts";
import { renderShortcutsPanel } from "../src/features/hub/controls/shortcuts.ts";
import { resetAllData } from "../src/features/hub/controls/actions.ts";

const LINKS = [
  { name: "Git", url: "https://github.com/", color: "#000000", emoji: "" },
  { name: "Doc", url: "https://docs.example/", color: "#ffffff", emoji: "" },
];

const stored = async (key: string) => (await chrome.storage.local.get(key))[key];
const storedLinks = async () => {
  const raw = await stored("SHORTCUTS_LINKS");
  return raw === undefined ? undefined : (JSON.parse(String(raw)) as typeof LINKS);
};

function shadowRoot(): ShadowRoot {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return host.attachShadow({ mode: "open" });
}

/** Every tab of the hub in a shadow root, wired as the hub wires them. */
async function renderHubTabs(): Promise<ShadowRoot> {
  const root = shadowRoot();
  const list = document.createElement("div");
  list.setAttribute("role", "tablist");
  root.appendChild(list);
  render(
    renderTabsContent(["shortcuts", "logtime", "profile"], { disabled: new Set(), hidden: new Set() }, {
      campuses: [],
      eventTypes: [],
    }),
    list,
  );
  bindTabPanels(root);
  await vi.waitFor(() => expect(root.querySelectorAll(".link-group").length).toBeGreaterThan(0));
  return root;
}

const rows = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>(".link-group")];
const field = (row: Element, attr: string) =>
  row.querySelector<HTMLInputElement>(`[${attr}]`)!;
const typeInto = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
};

let confirm: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  document.body.replaceChildren();
  await chrome.storage.local.clear();
  const storage = chrome.storage as unknown as { onChanged?: unknown };
  storage.onChanged ??= { addListener: vi.fn(), removeListener: vi.fn() };
  // the About tab counts users: no network in a unit test
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => null })));
  confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  account.logoutCloud.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a tab's Reset", () => {
  it("asks before resetting the Shortcuts tab, naming how many links go; cancelled, nothing goes", async () => {
    await chrome.storage.local.set({ SHORTCUTS_LINKS: JSON.stringify(LINKS) });
    const root = await renderHubTabs();
    await vi.waitFor(() => expect(rows(root)).toHaveLength(2));
    root.querySelector<HTMLButtonElement>('[data-reset-feature="shortcuts"]')!.click();
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm.mock.calls[0][0]).toMatch(/deletes your 2 shortcuts/);
    // nothing about the cloud while Auto push is off
    expect(confirm.mock.calls[0][0]).not.toMatch(/cloud/);
    expect(await storedLinks()).toEqual(LINKS);
    expect(rows(root)).toHaveLength(2);
  });

  it("confirmed, the links go and the editor shows it: typing does not bring them back", async () => {
    await chrome.storage.local.set({ SHORTCUTS_LINKS: JSON.stringify(LINKS) });
    const root = await renderHubTabs();
    await vi.waitFor(() => expect(rows(root)).toHaveLength(2));
    confirm.mockReturnValue(true);
    root.querySelector<HTMLButtonElement>('[data-reset-feature="shortcuts"]')!.click();
    await vi.waitFor(async () => expect(await stored("SHORTCUTS_LINKS")).toBeUndefined());
    // the editor reads the list back: only the empty row a fresh list starts with
    await vi.waitFor(() => expect(rows(root)).toHaveLength(1));
    expect(field(rows(root)[0], "data-shortcuts-name").value).toBe("");
    typeInto(field(rows(root)[0], "data-shortcuts-name"), "N");
    await vi.waitFor(async () => expect(await storedLinks()).toEqual([]), { timeout: 3000 });
  });

  it("says the cloud copy is replaced when Auto push would do it", async () => {
    await chrome.storage.local.set({
      SHORTCUTS_LINKS: JSON.stringify(LINKS.slice(0, 1)),
      CLOUD_SYNC_ENABLED: true,
      CLOUD_TOKEN: "t",
    });
    const message = await resetConfirmMessage("shortcuts");
    expect(message).toMatch(/deletes your 1 shortcut /);
    expect(message).toMatch(/cloud is replaced/);
    // signed out, Auto push pushes nothing
    await chrome.storage.local.remove("CLOUD_TOKEN");
    expect(await resetConfirmMessage("shortcuts")).not.toMatch(/cloud/);
  });

  it("asks on every tab, the Logtime tab included; cancelled, its settings stay", async () => {
    await chrome.storage.local.set({ LOGTIME_GOAL_HOURS: 120 });
    const root = await renderHubTabs();
    root.querySelector<HTMLButtonElement>('[data-reset-feature="logtime"]')!.click();
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm.mock.calls[0][0]).toMatch(/Reset the Logtime tab/);
    expect(await stored("LOGTIME_GOAL_HOURS")).toBe(120);

    confirm.mockReturnValue(true);
    root.querySelector<HTMLButtonElement>('[data-reset-feature="logtime"]')!.click();
    await vi.waitFor(async () => expect(await stored("LOGTIME_GOAL_HOURS")).toBeUndefined());
  });

  it("keeps the public profile warning on the Profile tab", async () => {
    await chrome.storage.local.set({ PROFILE_PUB_BIO: "hello" });
    expect(await resetConfirmMessage("profile")).toMatch(/public profile/);
  });
});

describe("the shortcut editor", () => {
  async function mountEditor(links: unknown[]): Promise<HTMLElement> {
    await chrome.storage.local.set({ SHORTCUTS_LINKS: JSON.stringify(links) });
    const root = shadowRoot();
    const panel = renderShortcutsPanel();
    root.appendChild(panel);
    await vi.waitFor(() => expect(rows(panel)).toHaveLength(links.length));
    return panel;
  }

  it("asks before removing a shortcut that holds something; cancelled, it stays", async () => {
    const panel = await mountEditor(LINKS);
    rows(panel)[0].querySelector<HTMLButtonElement>('[aria-label="Remove shortcut 1"]')!.click();
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm.mock.calls[0][0]).toContain('"Git"');
    expect(rows(panel)).toHaveLength(2);
    expect(await storedLinks()).toEqual(LINKS);

    confirm.mockReturnValue(true);
    rows(panel)[0].querySelector<HTMLButtonElement>('[aria-label="Remove shortcut 1"]')!.click();
    await vi.waitFor(async () => expect(await storedLinks()).toEqual([LINKS[1]]));
    expect(rows(panel)).toHaveLength(1);
  });

  it("removes an empty row without a question", async () => {
    const panel = await mountEditor([LINKS[0], { name: "", url: "", color: "#7dd3fc", emoji: "" }]);
    rows(panel)[1].querySelector<HTMLButtonElement>('[aria-label="Remove shortcut 2"]')!.click();
    await vi.waitFor(() => expect(rows(panel)).toHaveLength(1));
    expect(confirm).not.toHaveBeenCalled();
  });

  it("stores a move made with the arrows, and keeps the focus on the moved row", async () => {
    const panel = await mountEditor(LINKS);
    const down = rows(panel)[0].querySelector<HTMLButtonElement>("[data-move-down]")!;
    down.focus();
    down.click();
    await vi.waitFor(async () => expect(await storedLinks()).toEqual([LINKS[1], LINKS[0]]));
    expect(field(rows(panel)[0], "data-shortcuts-name").value).toBe("Doc");
    expect(field(rows(panel)[1], "data-shortcuts-name").value).toBe("Git");
    // at the end of the list the focus goes to the arrow still enabled
    const root = panel.getRootNode() as ShadowRoot;
    expect(root.activeElement).toBe(rows(panel)[1].querySelector("[data-move-up]"));
  });

  it("stores a move made by drag and drop in the preview", async () => {
    const panel = await mountEditor(LINKS);
    const chips = [...panel.querySelectorAll<HTMLElement>("#shortcuts-display a")];
    expect(chips).toHaveLength(2);
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (k: string, v: string) => data.set(k, v),
      getData: (k: string) => data.get(k) ?? "",
    };
    const drag = (type: string, el: Element) => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(e, "dataTransfer", { value: dataTransfer });
      el.dispatchEvent(e);
    };
    drag("dragstart", chips[0]);
    drag("drop", chips[1]);
    await vi.waitFor(async () => expect(await storedLinks()).toEqual([LINKS[1], LINKS[0]]));
  });

  it("keeps a half-typed row when another is added", async () => {
    const panel = await mountEditor([LINKS[0], { name: "", url: "", color: "#7dd3fc", emoji: "" }]);
    typeInto(field(rows(panel)[1], "data-shortcuts-name"), "Half");
    // the debounced save keeps complete rows only
    await vi.waitFor(async () => expect(await storedLinks()).toEqual([LINKS[0]]), { timeout: 3000 });
    const add = [...panel.querySelectorAll("button")].find((b) => /Add Link/.test(b.textContent ?? ""))!;
    add.click();
    await vi.waitFor(() => expect(rows(panel)).toHaveLength(3));
    expect(field(rows(panel)[1], "data-shortcuts-name").value).toBe("Half");
  });

  it("previews a typed address in its sanitised form, and keeps the field as typed", async () => {
    const panel = await mountEditor([{ name: "", url: "", color: "#7dd3fc", emoji: "" }]);
    const refresh = () =>
      [...panel.querySelectorAll("button")]
        .find((b) => /Update Preview/.test(b.textContent ?? ""))!
        .click();
    const chipHref = () =>
      panel.querySelector<HTMLAnchorElement>("#shortcuts-display a")!.getAttribute("href");
    typeInto(field(rows(panel)[0], "data-shortcuts-name"), "X");
    typeInto(field(rows(panel)[0], "data-shortcuts-url"), "github.com");
    refresh();
    expect(chipHref()).toBe("https://github.com/");
    expect(field(rows(panel)[0], "data-shortcuts-url").value).toBe("github.com");

    typeInto(field(rows(panel)[0], "data-shortcuts-url"), "javascript:alert(1)");
    refresh();
    expect(chipHref()).not.toMatch(/^javascript:/i);
    expect(field(rows(panel)[0], "data-shortcuts-url").value).toBe("javascript:alert(1)");
  });
});

describe("Reset all data", () => {
  it("says it signs out and what is lost; cancelled, nothing happens", async () => {
    await chrome.storage.local.set({ CLOUD_TOKEN: "t", LOGTIME_GOAL_HOURS: 120 });
    const ask = vi.fn(() => false);
    await resetAllData(ask);
    expect(ask.mock.calls[0][0]).toMatch(/signs you out/);
    expect(ask.mock.calls[0][0]).toMatch(/shortcuts, friends list, calendar link/);
    expect(account.logoutCloud).not.toHaveBeenCalled();
    expect(await stored("LOGTIME_GOAL_HOURS")).toBe(120);
  });

  it("confirmed while signed in, revokes the session on the worker before clearing", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    await chrome.storage.local.set({ CLOUD_TOKEN: "t", LOGTIME_GOAL_HOURS: 120 });
    let tokenAtLogout: unknown = "not called";
    account.logoutCloud.mockImplementationOnce(async () => {
      tokenAtLogout = await stored("CLOUD_TOKEN");
      return true;
    });
    await resetAllData(() => true);
    // logoutCloud needs the token to find the session: it runs first
    expect(tokenAtLogout).toBe("t");
    expect(await stored("LOGTIME_GOAL_HOURS")).toBeUndefined();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("signed out, asks without the sign-out part and calls no worker", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    const ask = vi.fn(() => true);
    await resetAllData(ask);
    expect(ask.mock.calls[0][0]).not.toMatch(/signs you out/);
    expect(account.logoutCloud).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
