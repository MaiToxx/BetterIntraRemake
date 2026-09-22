/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://profile-v3.intra.42.fr/users/bob" }
 *
 * When an Intra deploy renames one of the utility classes the profile pass
 * hangs off, the page looks exactly as if the extension were off. One console
 * line, naming the selector, is the whole difference for a bug report.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { findProfileCard } from "../src/features/profile/header/profile-card.ts";
import { resetSelectorProbes } from "../src/core/intra/selectors.ts";

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("load-bearing selector diagnostic", () => {
  const mountRenderedShell = () => {
    const root = document.createElement("div");
    root.id = "root";
    root.appendChild(document.createElement("main"));
    document.body.appendChild(root);
  };

  beforeEach(() => {
    resetSelectorProbes();
    history.replaceState({}, "", "/users/bob");
  });

  it("warns once, naming the selector, when the profile card never shows up", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mountRenderedShell();
    // the profile pass asks on every burst; the probe is armed once
    expect(findProfileCard()).toBeNull();
    expect(findProfileCard()).toBeNull();
    expect(vi.getTimerCount()).toBe(1);
    expect(warn).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10000);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain("profile card");
    expect(line).toContain('p[class="text-sm"]');
    expect(line).toMatch(/after 10s/);
    expect(vi.getTimerCount()).toBe(0);
    warn.mockRestore();
  });

  it("stays quiet when the card arrives before the deadline", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mountRenderedShell();
    expect(findProfileCard()).toBeNull();
    const login = document.createElement("p");
    login.className = "text-sm";
    const row = document.createElement("div");
    row.className = "flex flex-col lg:flex-row";
    row.appendChild(login);
    document.getElementById("root")!.appendChild(row);
    await vi.advanceTimersByTimeAsync(10000);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("stays quiet on a blank shell and off the profile routes", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // no rendered #root: the page is still loading or is an error page
    expect(findProfileCard()).toBeNull();
    await vi.advanceTimersByTimeAsync(10000);
    expect(warn).not.toHaveBeenCalled();

    resetSelectorProbes();
    history.replaceState({}, "", "/settings");
    mountRenderedShell();
    expect(findProfileCard()).toBeNull();
    await vi.advanceTimersByTimeAsync(30000);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
