/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://profile-v3.intra.42.fr/" }
 */
/**
 * The avatar is hidden by the page sheet until the custom one is painted, and
 * only the profile watcher paints it. The rule used to be unconditional and
 * outlive the watcher (30 s on the dashboard, one pass on /users/*): every
 * avatar React mounted after that stayed at opacity 0 for the rest of the
 * visit. It now applies only while the watcher holds the avatar.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// initProfile() runs ~20 feature inits per pass; none of them is what this
// suite is about, so they are stubbed. The visuals apply step stays real: it
// owns the stylesheet under test.
vi.mock("../src/features/profile/header/visuals.ts", async () => {
  const apply = await vi.importActual<
    typeof import("../src/features/profile/header/visuals-apply.ts")
  >("../src/features/profile/header/visuals-apply.ts");
  return {
    injectCustomStyles: apply.injectCustomStyles,
    // What a real pass does once the visuals are known: paint and reveal.
    updateVisuals: vi.fn(async () => {
      const el = document.querySelector<HTMLElement>("div.rounded-full.w-52.h-52");
      el?.style.setProperty("opacity", "1", "important");
    }),
  };
});
vi.mock("../src/features/profile/header/profile-card.ts", () => ({
  findProfileCard: () => document.querySelector(".profile-card"),
  initProfileCardStyling: vi.fn(async () => {}),
  applyThemeToProfileCard: vi.fn(),
}));
vi.mock("../src/features/profile/cards/events/events.ts", () => ({
  updateEventFilters: vi.fn(async () => {}),
  injectEventsSelect: vi.fn(async () => {}),
}));
vi.mock("../src/features/profile/shortcuts.ts", () => ({
  findSlotsButton: vi.fn(async () => {}),
  redirectDefenseLinks: vi.fn(async () => {}),
}));
vi.mock("../src/features/profile/moulinette.ts", () => ({ replaceMoulinetteImage: vi.fn() }));
vi.mock("../src/features/profile/layout/highlight.ts", () => ({
  handleProfileRedirect: vi.fn(async () => {}),
}));
vi.mock("../src/features/profile/layout/layout.ts", () => ({
  initLayoutManager: vi.fn(async () => {}),
}));
vi.mock("../src/features/profile/cards/milestones.ts", () => ({
  initMilestones: vi.fn(async () => {}),
}));
vi.mock("../src/features/profile/cards/freeze.ts", () => ({
  initFreezeCard: vi.fn(async () => {}),
}));
vi.mock("../src/features/friends/friends.ui.ts", () => ({
  injectFriendsWidget: vi.fn(async () => {}),
}));
vi.mock("../src/features/logtime/tracker-card.ts", () => ({ colorTrackerBadge: vi.fn() }));
vi.mock("../src/features/profile/cards/achievements.ts", () => ({
  initAchievements: vi.fn(async () => {}),
}));
vi.mock("../src/features/profile/cards/marks.ts", () => ({ initMarks: vi.fn(async () => {}) }));
vi.mock("../src/features/profile/cards/project-badges.ts", () => ({
  initProjectBadges: vi.fn(async () => {}),
}));
vi.mock("../src/features/profile/cards/projects-sort.ts", () => ({
  initProjectsSort: vi.fn(async () => {}),
}));
vi.mock("../src/features/profile/cards/roulette-stats.ts", () => ({
  initRouletteStats: vi.fn(async () => {}),
}));
vi.mock("../src/features/profile/cards/evaluations.ts", () => ({
  initEvaluations: vi.fn(async () => {}),
}));
vi.mock("../src/features/profile/header/badges.ts", () => ({
  initBadges: vi.fn(async () => {}),
  applyTitleBadgeWrap: vi.fn(async () => {}),
}));
vi.mock("../src/features/profile/cards/transcript.ts", () => ({
  initTranscript: vi.fn(async () => {}),
}));
vi.mock("../src/features/profile/cards/pace.ts", () => ({ initPace: vi.fn(async () => {}) }));
vi.mock("../src/features/clusters/clusters.data.ts", () => ({
  ensureCampusData: vi.fn(async () => {}),
}));
vi.mock("../src/features/customize/cards.ts", () => ({ tagDashboardCards: vi.fn() }));

import { initProfile } from "../src/features/profile/profile.ts";
import {
  AVATAR_PENDING_CLASS,
  holdAvatar,
  injectCustomStyles,
  releaseAvatar,
} from "../src/features/profile/header/visuals-apply.ts";

const AVATAR_CLASS = "rounded-full w-52 h-52";

const mountAvatar = (): HTMLElement => {
  const el = document.createElement("div");
  el.className = AVATAR_CLASS;
  document.body.appendChild(el);
  return el;
};

/** A React re-render: the avatar element is replaced, inline styles and all. */
const remountAvatar = (): HTMLElement => {
  const fresh = document.createElement("div");
  fresh.className = AVATAR_CLASS;
  const old = document.querySelector("div.rounded-full.w-52.h-52");
  if (old) old.replaceWith(fresh);
  else document.body.appendChild(fresh);
  return fresh;
};

const opacity = (el: HTMLElement) => getComputedStyle(el).opacity;
const held = () => document.documentElement.classList.contains(AVATAR_PENDING_CLASS);

/** Let a profile pass run (80 ms debounce, then a frame, then the async inits). */
const runPass = async () => {
  await vi.advanceTimersByTimeAsync(200);
};

beforeEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
  document.documentElement.classList.remove(AVATAR_PENDING_CLASS);
  history.replaceState(null, "", "/");
});

afterEach(() => {
  // Stops the watcher a test left running.
  window.dispatchEvent(new Event("pagehide"));
  vi.useRealTimers();
});

describe("the page sheet hides the avatar only while it is held", () => {
  it("hides an unpainted avatar while held", () => {
    injectCustomStyles();
    holdAvatar();
    expect(opacity(mountAvatar())).toBe("0");
  });

  it("lets a new avatar show once released", () => {
    injectCustomStyles();
    holdAvatar();
    mountAvatar();
    releaseAvatar();
    // Before the fix the rule had no condition: this read "0" for good.
    expect(opacity(remountAvatar())).not.toBe("0");
  });

  it("keeps an avatar the visuals revealed visible either way", () => {
    injectCustomStyles();
    holdAvatar();
    const el = mountAvatar();
    el.style.setProperty("opacity", "1", "important");
    expect(opacity(el)).toBe("1");
    releaseAvatar();
    expect(opacity(el)).toBe("1");
  });
});

describe("initProfile holds the avatar for as long as its watcher runs", () => {
  const mountProfile = () => {
    const card = document.createElement("div");
    card.className = "profile-card";
    document.body.appendChild(card);
    return mountAvatar();
  };

  it("hides it from the start, so the Intra picture never flashes on load", async () => {
    vi.useFakeTimers();
    const avatar = mountProfile();
    void initProfile();
    // Synchronously, before initProfile's first await: as early as the old rule.
    expect(held()).toBe(true);
    expect(opacity(avatar)).toBe("0");

    await runPass();
    expect(opacity(avatar)).toBe("1");

    // A re-render while the watcher still runs stays hidden until it is
    // repainted, as before: no Intra picture in between.
    const fresh = remountAvatar();
    expect(opacity(fresh)).toBe("0");
    await runPass();
    expect(opacity(fresh)).toBe("1");
  });

  it("dashboard: an avatar mounted after the 30 s watcher stopped is visible", async () => {
    vi.useFakeTimers();
    mountProfile();
    void initProfile();
    await runPass();
    expect(held()).toBe(true);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(held()).toBe(false);
    // Nothing paints this one any more: it used to stay at opacity 0.
    expect(opacity(remountAvatar())).not.toBe("0");
  });

  it("/users/*: released as soon as its single pass is done", async () => {
    history.replaceState(null, "", "/users/bob");
    vi.useFakeTimers();
    mountProfile();
    void initProfile();
    await runPass();

    // The observer is disconnected after this first pass, long before the
    // 10 s stop: a re-mounted avatar must not wait for that timer.
    expect(held()).toBe(false);
    expect(opacity(remountAvatar())).not.toBe("0");
  });

  it("/users/*: still held while the profile has not rendered yet", async () => {
    history.replaceState(null, "", "/users/bob");
    vi.useFakeTimers();
    const avatar = mountAvatar(); // no profile card: the pass is not final
    void initProfile();
    await runPass();
    expect(held()).toBe(true);
    avatar.style.removeProperty("opacity");
    expect(opacity(avatar)).toBe("0");
  });

  it("releases it on pagehide", async () => {
    vi.useFakeTimers();
    mountProfile();
    void initProfile();
    await runPass();
    window.dispatchEvent(new Event("pagehide"));
    expect(held()).toBe(false);
  });
});
