import { describe, it, expect, vi, beforeEach } from "vitest";

// The editor itself is heavy (tabs, image history, cloud sync): stand in a
// slow createSettingsModal that resolves when the test says so.
let finish: (() => void) | null = null;
const createSettingsModal = vi.fn(
  () =>
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
);
vi.mock("../src/features/profile/header/profile.modal.ts", () => ({ createSettingsModal }));

const { openEditor } = await import("../src/features/profile/header/avatar-clicks.ts");

beforeEach(() => {
  createSettingsModal.mockClear();
  finish = null;
});

describe("opening the profile editor", () => {
  it("a second click while it is opening joins it instead of opening another", async () => {
    const onSave = vi.fn();
    const first = openEditor(onSave);
    const second = openEditor(onSave);
    expect(second).toBe(first);
    await Promise.resolve();
    expect(createSettingsModal).toHaveBeenCalledTimes(1);

    finish?.();
    await first;
    // once it has opened, the next click opens it again (after closing)
    const third = openEditor(onSave);
    await Promise.resolve();
    expect(createSettingsModal).toHaveBeenCalledTimes(2);
    finish?.();
    await third;
  });

  it("a failure is reported quietly and does not block the next click", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    createSettingsModal.mockImplementationOnce(() => Promise.reject(new Error("boom")));
    await openEditor(vi.fn());
    expect(warn).toHaveBeenCalled();
    const again = openEditor(vi.fn());
    await Promise.resolve();
    expect(createSettingsModal).toHaveBeenCalledTimes(2);
    finish?.();
    await again;
    warn.mockRestore();
  });
});
