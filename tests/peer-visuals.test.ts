/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://profile-v3.intra.42.fr/users/bob" }
 *
 * Another student's visuals on their profile: the pass no longer waits for
 * the worker's answer (every card init used to sit behind it, up to its 8 s
 * timeout), and a record stored minutes ago (by the friends widget) is used
 * without asking the worker again.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const account = vi.hoisted(() => ({
  getCloudLogin: vi.fn(async () => "me" as string | null),
  fetchUserVisuals: vi.fn(),
}));
vi.mock("../src/features/account/account.ts", () => account);

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const BOB = {
  avatar: "https://img.example/bob.png",
  banner: "",
  bannerMode: "fill",
  bannerColor: "",
  background: "",
  backgroundMode: "fill",
  backgroundColor: "",
  avatarBg: "transparent",
  decoration: "none",
  avatarPosX: 50,
  avatarPosY: 50,
  avatarScale: 100,
  badgeBg: "",
  theme: null,
  logtime: null,
  look: null,
  extras: null,
};
const NOTHING = { ...BOB, avatar: "" };

function mountAvatar(): HTMLElement {
  const avatar = document.createElement("div");
  avatar.className = "rounded-full w-52 h-52";
  document.body.appendChild(avatar);
  return avatar;
}

async function loadVisuals() {
  vi.resetModules();
  return import("../src/features/profile/header/visuals.ts");
}

beforeEach(async () => {
  document.body.replaceChildren();
  await chrome.storage.local.clear();
  account.fetchUserVisuals.mockReset();
});

describe("a peer's visuals, first visit", () => {
  it("does not hold the pass while the worker answers, then paints the answer", async () => {
    const answer = deferred<typeof BOB | null>();
    account.fetchUserVisuals.mockReturnValue(answer.promise);
    const { updateVisuals } = await loadVisuals();
    const avatar = mountAvatar();

    // Resolves although the worker has not answered: the card inits of the
    // pass (marks, freeze, roulette, Add friend...) run right away.
    await updateVisuals();
    expect(account.fetchUserVisuals).toHaveBeenCalledWith("bob");
    expect(avatar.style.backgroundImage).toBe("");

    // A pass meanwhile does not send a second request.
    await updateVisuals();
    expect(account.fetchUserVisuals).toHaveBeenCalledTimes(1);

    answer.resolve(BOB);
    await vi.waitFor(() => expect(avatar.style.backgroundImage).toContain("bob.png"));
    expect(avatar.style.opacity).toBe("1");
    await vi.waitFor(async () => {
      const stored = await chrome.storage.local.get("visuals_cache_bob");
      expect((stored.visuals_cache_bob as { avatar: string }).avatar).toContain("bob.png");
    });
  });

  it("reveals the avatar when the student publishes nothing, and asks no more this page", async () => {
    account.fetchUserVisuals.mockResolvedValue(NOTHING);
    const { updateVisuals } = await loadVisuals();
    const avatar = mountAvatar();
    await updateVisuals();
    await vi.waitFor(() => expect(avatar.style.opacity).toBe("1"));
    await updateVisuals();
    expect(account.fetchUserVisuals).toHaveBeenCalledTimes(1);
  });

  it("asks again on a later pass when the request failed", async () => {
    account.fetchUserVisuals.mockResolvedValueOnce(null).mockResolvedValue(NOTHING);
    const { updateVisuals } = await loadVisuals();
    const avatar = mountAvatar();
    await updateVisuals();
    await vi.waitFor(() => expect(avatar.style.opacity).toBe("1"));
    await updateVisuals();
    expect(account.fetchUserVisuals).toHaveBeenCalledTimes(2);
  });
});

describe("a peer's stored visuals", () => {
  it("are painted without a request while fresh (stored by the friends widget minutes ago)", async () => {
    await chrome.storage.local.set({
      visuals_cache_bob: { ...BOB, fetchedAt: Date.now() - 60_000 },
    });
    const { updateVisuals } = await loadVisuals();
    const avatar = mountAvatar();
    await updateVisuals();
    expect(avatar.style.backgroundImage).toContain("bob.png");
    expect(account.fetchUserVisuals).not.toHaveBeenCalled();
  });

  it("a fresh 'no visuals' record costs no request either", async () => {
    await chrome.storage.local.set({
      visuals_cache_bob: { ...NOTHING, fetchedAt: Date.now() - 60_000 },
    });
    const { updateVisuals } = await loadVisuals();
    const avatar = mountAvatar();
    await updateVisuals();
    expect(avatar.style.opacity).toBe("1");
    expect(account.fetchUserVisuals).not.toHaveBeenCalled();
  });

  it("are painted at once and revalidated once older than ten minutes", async () => {
    await chrome.storage.local.set({
      visuals_cache_bob: { ...BOB, fetchedAt: Date.now() - 11 * 60_000 },
    });
    const answer = deferred<typeof BOB>();
    account.fetchUserVisuals.mockReturnValue(answer.promise);
    const { updateVisuals } = await loadVisuals();
    const avatar = mountAvatar();
    await updateVisuals();
    expect(avatar.style.backgroundImage).toContain("bob.png");
    expect(account.fetchUserVisuals).toHaveBeenCalledTimes(1);
    answer.resolve({ ...BOB, avatar: "https://img.example/new.png" });
    await vi.waitFor(() => expect(avatar.style.backgroundImage).toContain("new.png"));
  });
});
