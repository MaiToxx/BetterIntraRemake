/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://profile-v3.intra.42.fr/users/bob" }
 *
 * The profile header's own controls: the Add friend button works without the
 * cloud sign-in (the friends list is local storage, like the widget's), and
 * the shortcut row fits a phone.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/features/clusters/map-dialog.ts", () => ({ openClusterDialog: vi.fn() }));

const { initFriendBadge, initShortcutButtons } = await import(
  "../src/features/profile/header/personal-info.ts"
);

/** The Intra's header column the button goes into. */
function mountHeader(): HTMLElement {
  const column = document.createElement("div");
  column.className = "flex flex-col justify-center gap-4";
  document.body.appendChild(column);
  return column;
}

beforeEach(async () => {
  document.body.replaceChildren();
  await chrome.storage.local.clear();
});

describe("Add friend button", () => {
  it("shows on a classmate's profile when not signed in to cloud sync", async () => {
    mountHeader();
    await initFriendBadge();
    const btn = document.querySelector<HTMLButtonElement>("[data-ft-friend]");
    expect(btn, "the button needs no worker").not.toBeNull();
    await vi.waitFor(() => expect(btn!.textContent).toContain("Add friend"));

    btn!.click();
    await vi.waitFor(() => expect(btn!.textContent).toContain("Remove friend"));
    const { FRIENDS_LIST } = await chrome.storage.local.get("FRIENDS_LIST");
    expect(JSON.stringify(FRIENDS_LIST)).toContain("bob");
  });

  it("stays off your own profile when the signed-in login tells it is yours", async () => {
    await chrome.storage.local.set({ CLOUD_LOGIN: "bob", CLOUD_TOKEN: "tok" });
    mountHeader();
    await initFriendBadge();
    expect(document.querySelector("[data-ft-friend]")).toBeNull();
  });
});

describe("shortcut row", () => {
  it("wraps and slims its padding on a phone, and keeps the desktop row as it was", async () => {
    const box = document.createElement("div");
    box.className =
      "border border-ft-gray-border bg-ft-gray/50 rounded-xl flex justify-center items-center w-full";
    document.body.appendChild(box);

    await initShortcutButtons();

    expect(box.hasAttribute("data-ft-shortcuts")).toBe(true);
    expect(box.querySelectorAll(":scope > div.px-4")).toHaveLength(3);
    const css = box.querySelector("style")!.textContent!.replace(/\s+/g, " ");
    const phone = css.match(/@media \(max-width: 479px\) \{((?:[^{}]*\{[^}]*\})*) \}/);
    expect(phone, "a phone-only block").not.toBeNull();
    expect(phone![1]).toContain("[data-ft-shortcuts] { flex-wrap: wrap; row-gap: 0.25rem; }");
    // (0,1,1) beats the wrappers' .px-4 (0,1,0), and never matches the <style>
    expect(phone![1]).toContain(
      "[data-ft-shortcuts] > div { padding-left: 0.25rem; padding-right: 0.25rem; }",
    );
    // Desktop keeps the row as it was: measured in Chrome, a 393 px box (the
    // header at 1470 px) with wrap allowed put "Settings" on a second line
    // instead of breaking "Holy Graph", and no horizontal gap anywhere.
    const desktop = css.replace(phone![0], "");
    expect(desktop).not.toMatch(/flex-wrap/);
    const rowRules = [...css.matchAll(/\[data-ft-shortcuts\] \{([^}]*)\}/g)].map((m) => m[1]);
    expect(rowRules).toHaveLength(1);
    expect(rowRules[0]).not.toMatch(/(^|[;\s])(column-)?gap:/);
  });
});
