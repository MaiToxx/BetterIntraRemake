import { describe, it, expect, vi, beforeEach } from "vitest";

// The profile header's entry points must work from the keyboard (Enter and
// Space, like a native button) and say what they are, without changing what
// a mouse user sees.

const createSettingsModal = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../src/features/profile/header/profile.modal.ts", () => ({ createSettingsModal }));

const openClusterDialog = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../src/features/clusters/map-dialog.ts", () => ({ openClusterDialog }));
vi.mock("../src/features/clusters/clusters.data.ts", () => ({
  CLUSTERS: [{ name: "k1" }],
  getClusterData: async () => ({ clusters: [] }),
}));
vi.mock("../src/features/profile/header/personal-info.ts", () => ({
  initShortcutButtons: async () => {},
  initFriendBadge: async () => {},
}));
vi.mock("../src/features/campus/campus-flags.ts", () => ({ injectCampusFlag: () => {} }));

const { attachEditorListener, attachToggleListener } = await import(
  "../src/features/profile/header/avatar-clicks.ts"
);
const { pageState } = await import("../src/features/profile/header/visuals-apply.ts");
const { initProfileCardStyling } = await import(
  "../src/features/profile/header/profile-card.ts"
);

function key(el: Element, k: string, init: KeyboardEventInit = {}) {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(e);
  return e;
}

function avatar(): HTMLElement {
  const el = document.createElement("div");
  el.className = "rounded-full w-52 h-52 bg-cover";
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
  createSettingsModal.mockClear();
  openClusterDialog.mockClear();
  pageState.showingOriginalAvatar = false;
});

describe("my avatar: the way into the visuals editor", () => {
  it("is a focusable, named button", () => {
    const el = avatar();
    attachEditorListener(el, vi.fn());
    expect(el.tabIndex).toBe(0);
    expect(el.getAttribute("role")).toBe("button");
    expect(el.getAttribute("aria-label")).toBe("Edit my profile visuals");
    expect(el.title).toBe("Edit my profile visuals");
  });

  it("Enter and Space open the editor; Space does not scroll the page", async () => {
    const el = avatar();
    attachEditorListener(el, vi.fn());
    expect(key(el, "Enter").defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(createSettingsModal).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    const space = key(el, " ");
    expect(space.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(createSettingsModal).toHaveBeenCalledTimes(2));
  });

  it("other keys, and keys aimed at something inside it, are left alone", async () => {
    const el = avatar();
    const inner = document.createElement("input");
    el.appendChild(inner);
    attachEditorListener(el, vi.fn());
    expect(key(el, "a").defaultPrevented).toBe(false);
    expect(key(inner, "Enter").defaultPrevented).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(createSettingsModal).not.toHaveBeenCalled();
  });

  it("a click still opens it", async () => {
    const el = avatar();
    attachEditorListener(el, vi.fn());
    el.click();
    await vi.waitFor(() => expect(createSettingsModal).toHaveBeenCalledTimes(1));
  });
});

describe("someone else's avatar: the original-picture toggle", () => {
  it("is a focusable toggle button that reports its state", () => {
    const el = avatar();
    attachToggleListener(el, () => null);
    expect(el.tabIndex).toBe(0);
    expect(el.getAttribute("role")).toBe("button");
    expect(el.getAttribute("aria-label")).toBe("Show original avatar");
    expect(el.getAttribute("aria-pressed")).toBe("false");
    // the mouse user's hint is unchanged
    expect(el.title).toBe("Click to view original avatar");
  });

  it("Enter and Space toggle it, and aria-pressed follows", () => {
    const el = avatar();
    pageState.originalAvatarUrl = "https://cdn.intra.42.fr/users/x.jpg";
    attachToggleListener(el, () => ({
      avatar: "https://img.example/custom.png",
      banner: "",
      bannerMode: "fill",
      background: "",
      backgroundMode: "fill",
    }));
    expect(key(el, "Enter").defaultPrevented).toBe(true);
    expect(pageState.showingOriginalAvatar).toBe(true);
    expect(el.getAttribute("aria-pressed")).toBe("true");
    expect(el.style.backgroundImage).toContain("x.jpg");

    expect(key(el, " ").defaultPrevented).toBe(true);
    expect(pageState.showingOriginalAvatar).toBe(false);
    expect(el.getAttribute("aria-pressed")).toBe("false");
    expect(el.style.backgroundImage).toContain("custom.png");
  });

  it("aria-pressed is brought up to date on focus if the page reset the state", () => {
    const el = avatar();
    attachToggleListener(el, () => null);
    el.click();
    expect(el.getAttribute("aria-pressed")).toBe("true");
    pageState.showingOriginalAvatar = false; // visuals.ts does this on a new profile
    el.dispatchEvent(new FocusEvent("focus"));
    expect(el.getAttribute("aria-pressed")).toBe("false");
  });
});

// ---------------------------------------------------------------------------
// The modern info card
// ---------------------------------------------------------------------------

/** A profile card shaped like the Intra's: login, stats bar, seat pill. */
function intraProfileCard(seat: string) {
  const card = document.createElement("div");
  const row = document.createElement("div");
  row.className = "flex flex-col lg:flex-row";
  const login = document.createElement("p");
  login.setAttribute("class", "text-sm");
  login.textContent = "someone";
  row.appendChild(login);
  card.appendChild(row);

  const stats = document.createElement("div");
  stats.className = "border-t-neutral-600";
  for (const [label, value] of [
    ["Wallet ₳", "120"],
    ["Ev.P", "5"],
    ["Grade", "Member"],
  ]) {
    const item = document.createElement("div");
    const b = document.createElement("b");
    b.textContent = label;
    const s = document.createElement("span");
    s.textContent = value;
    item.append(b, s);
    stats.appendChild(item);
  }
  const give = document.createElement("button");
  give.setAttribute("aria-haspopup", "dialog");
  give.setAttribute("aria-label", "Give evaluation points to someone");
  give.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
  const giveClicks = vi.fn();
  give.addEventListener("click", giveClicks);
  stats.appendChild(give);
  card.appendChild(stats);

  const pill = document.createElement("div");
  pill.className =
    "absolute px-2 py-1 border rounded-full border-neutral-600 bg-ft-gray top-2 right-4";
  pill.textContent = seat;
  card.appendChild(pill);

  document.body.appendChild(card);
  return { card, giveClicks };
}

async function infoCard(seat = "k1r2p3") {
  const intra = intraProfileCard(seat);
  await initProfileCardStyling();
  const root = document.getElementById("profile-badges-shadow")!.shadowRoot!;
  await vi.waitFor(() => expect(root.querySelector("[data-ft-seat]")).not.toBeNull());
  return { root, ...intra };
}

describe("modern info card", () => {
  it("the give-points icon is a real, named button that opens the Intra's dialog", async () => {
    const { root, giveClicks } = await infoCard();
    const btn = root.querySelector<HTMLButtonElement>("[data-ft-give-points]")!;
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.type).toBe("button");
    expect(btn.getAttribute("aria-label")).toBe("Give evaluation points to someone");
    expect(btn.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    btn.click();
    expect(giveClicks).toHaveBeenCalledTimes(1);
    // only the icon reacts, so the rest of the Ev.P badge no longer promises a click
    const evBadge = btn.closest<HTMLElement>("[data-ft-badge]")!;
    expect(evBadge.style.cursor).toBe("");
  });

  it("the wallet badge is a link to the shop (keyboard, middle-click, status bar)", async () => {
    const { root } = await infoCard();
    const wallet = [...root.querySelectorAll<HTMLElement>("[data-ft-badge]")].find((b) =>
      b.textContent?.includes("₳"),
    )!;
    expect(wallet.tagName).toBe("A");
    expect(wallet.getAttribute("href")).toBe("https://shop.intra.42.fr/");
    expect(wallet.getAttribute("target")).toBe("_blank");
    expect(wallet.getAttribute("rel")).toContain("noopener");
    // same look as the other badges
    expect(wallet.className).toBe(
      "badge badge-lg h-auto flex w-full justify-between gap-4 px-5 py-1.5 text-lg",
    );
  });

  it("a seat on a known cluster is a named button that Enter and Space open", async () => {
    const { root } = await infoCard("k1r2p3");
    const seat = root.querySelector<HTMLElement>("[data-ft-seat]")!;
    expect(seat.tabIndex).toBe(0);
    expect(seat.getAttribute("role")).toBe("button");
    expect(seat.getAttribute("aria-label")).toBe("Show k1r2p3 on the cluster map");
    expect(seat.dataset.tip).toBe("View on cluster map");
    expect(seat.style.cursor).toBe("pointer");
    expect(seat.querySelector("svg")).not.toBeNull();

    expect(key(seat, "Enter").defaultPrevented).toBe(true);
    expect(openClusterDialog).toHaveBeenLastCalledWith({ seatId: "k1r2p3" });
    expect(key(seat, " ").defaultPrevented).toBe(true);
    expect(openClusterDialog).toHaveBeenCalledTimes(2);
    seat.click();
    expect(openClusterDialog).toHaveBeenCalledTimes(3);
  });

  it("a seat on no known cluster no longer looks like a link", async () => {
    const { root } = await infoCard("z9r9p9");
    const seat = root.querySelector<HTMLElement>("[data-ft-seat]")!;
    expect(seat.textContent).toContain("z9r9p9");
    expect(seat.getAttribute("role")).toBeNull();
    expect(seat.hasAttribute("tabindex")).toBe(false);
    expect(seat.dataset.tip).toBeUndefined();
    expect(seat.style.cursor).toBe("");
    expect(seat.querySelector("svg")).toBeNull();
    key(seat, "Enter");
    seat.click();
    expect(openClusterDialog).not.toHaveBeenCalled();
  });

  it("keyboard focus is visible on the badges and on the avatar", async () => {
    const { root } = await infoCard();
    const css = [...root.querySelectorAll("style")].map((s) => s.textContent).join("\n");
    expect(css).toMatch(/\[data-ft-badge\]:focus-visible/);
    expect(css).toMatch(/\[data-ft-give-points\]:focus-visible/);
    const page = document.getElementById("ft-profile-card-styles")!.textContent!;
    expect(page).toMatch(/\[data-modal-listener\]:focus-visible/);
    expect(page).toMatch(/\[data-toggle-listener\]:focus-visible/);
  });
});
