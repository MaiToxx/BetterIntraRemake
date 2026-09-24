/**
 * The seat on a profile card. Thirteen campuses have no cluster data: the
 * lookup threw after the Intra's own seat pill was hidden, and the seat was
 * shown nowhere. And a seat belongs to the LONGEST cluster name it starts
 * with: Paris lists f1 before f1b.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/features/profile/header/profile.modal.ts", () => ({ createSettingsModal: vi.fn() }));
vi.mock("../src/features/clusters/map-dialog.ts", () => ({ openClusterDialog: vi.fn() }));
const getClusterData = vi.hoisted(() => vi.fn(async () => { throw new Error("Failed to fetch campus data"); }));
vi.mock("../src/features/clusters/clusters.data.ts", () => ({ CLUSTERS: [], getClusterData }));
vi.mock("../src/features/profile/header/personal-info.ts", () => ({
  initShortcutButtons: async () => {},
  initFriendBadge: async () => {},
}));
vi.mock("../src/features/campus/campus-flags.ts", () => ({ injectCampusFlag: () => {} }));

const { initProfileCardStyling } = await import("../src/features/profile/header/profile-card.ts");
const { findClusterForSeat } = await import("../src/features/clusters/map-dialog/helpers.ts");

function intraCardWithSeat(seat: string): HTMLElement {
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
  card.appendChild(stats);
  const pill = document.createElement("div");
  pill.className = "absolute px-2 py-1 border rounded-full border-neutral-600 bg-ft-gray top-2 right-4";
  pill.textContent = seat;
  card.appendChild(pill);
  document.body.appendChild(card);
  return pill;
}

beforeEach(async () => {
  document.body.replaceChildren();
  document.head.replaceChildren();
  await chrome.storage.local.clear();
});

describe("seat badge on a campus without cluster data", () => {
  it("still shows the seat, as plain text, and only then hides the Intra's pill", async () => {
    await chrome.storage.local.set({ CLUSTERS_CAMPUS: "lyon" });
    const pill = intraCardWithSeat("z2r3p4");
    await initProfileCardStyling();
    const root = document.getElementById("profile-badges-shadow")!.shadowRoot!;
    await vi.waitFor(() => expect(root.querySelector("[data-ft-seat]")).not.toBeNull());
    const seat = root.querySelector<HTMLElement>("[data-ft-seat]")!;
    expect(seat.textContent).toContain("z2r3p4");
    expect(seat.getAttribute("role")).toBeNull();
    expect(pill.style.display).toBe("none");
    expect(getClusterData).toHaveBeenCalledWith("lyon");
  });

  it("no campus known yet: no lookup at all (an empty id loaded another campus)", async () => {
    getClusterData.mockClear();
    intraCardWithSeat("z2r3p4");
    await initProfileCardStyling();
    const root = document.getElementById("profile-badges-shadow")!.shadowRoot!;
    await vi.waitFor(() => expect(root.querySelector("[data-ft-seat]")).not.toBeNull());
    expect(getClusterData).not.toHaveBeenCalled();
  });
});

describe("findClusterForSeat", () => {
  const paris = [
    { id: "1", name: "f0" },
    { id: "2", name: "f1" },
    { id: "3", name: "f1b" },
    { id: "4", name: "f2" },
  ];
  it("picks the longest cluster name the seat starts with", () => {
    expect(findClusterForSeat(paris, "f1br2s3")?.name).toBe("f1b");
    expect(findClusterForSeat(paris, "f1r2s3")?.name).toBe("f1");
    expect(findClusterForSeat([{ id: "a", name: "f1" }, { id: "b", name: "f1r7" }], "f1r7s2")?.name).toBe("f1r7");
  });
  it("ignores case and separators, and finds nothing off the list", () => {
    expect(findClusterForSeat(paris, "F1B-R2-S3")?.name).toBe("f1b");
    expect(findClusterForSeat(paris, "k1r1p1")).toBeUndefined();
    expect(findClusterForSeat([{ id: "x", name: "  " }], "k1")).toBeUndefined();
  });
});
