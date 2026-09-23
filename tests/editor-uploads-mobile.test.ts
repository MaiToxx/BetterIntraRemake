/**
 * The avatar tab in a phone-sized or narrow window (under Tailwind's sm,
 * 640 px): the preview column used to sit beside the form at a fixed 256 px,
 * which left the URL box 0 px wide with the preview over the Upload button,
 * and the preview could only be dragged with a mouse.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "lit-html";
import { renderTabPanels } from "../src/features/profile/header/profile-modal-tabs.ts";
import { createPendingUploads } from "../src/features/profile/header/pending-uploads.ts";
import { renderAvatarEditor } from "../src/features/profile/header/avatar-editor.ts";
import type { FormState } from "../src/features/profile/header/profile-modal-form.ts";

const STATE: FormState = {
  avatar: "https://img.example/a.png",
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
  badgeOrder: [],
  badgeWrap: false,
};

function avatarTab(): HTMLElement {
  const host = document.createElement("div");
  const panels = renderTabPanels(
    STATE,
    () => {},
    { avatar: [], banner: [], background: [] },
    () => {},
    createPendingUploads(() => {}),
  );
  render(panels.avatar, host);
  return host;
}

describe("avatar tab layout", () => {
  it("stacks the form over the preview below sm, side by side from sm up", () => {
    const tab = avatarTab();
    const row = tab.querySelector<HTMLElement>("[data-avatar-row]")!;
    expect([...row.classList]).toEqual(
      expect.arrayContaining(["flex", "flex-col", "sm:flex-row", "sm:items-start"]),
    );
    // stretched when stacked: `items-start` on the column made the form shrink-to-fit
    expect(row.classList.contains("items-start")).toBe(false);
    const column = tab.querySelector<HTMLElement>("[data-avatar-preview-column]")!;
    expect([...column.classList]).toEqual(
      expect.arrayContaining(["w-full", "sm:w-64", "items-center", "sm:items-start"]),
    );
    expect(column.classList.contains("w-64")).toBe(false);
  });

  it("lets the Upload button wrap under the URL box instead of crushing it", () => {
    const tab = avatarTab();
    const box = tab.querySelector<HTMLElement>("label.input")!;
    expect(box.classList.contains("min-w-40")).toBe(true);
    expect(box.parentElement!.classList.contains("flex-wrap")).toBe(true);
  });
});

describe("dragging the avatar preview", () => {
  function preview(onUpdate: (c: Record<string, number>) => void, scale = 150) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    render(
      renderAvatarEditor(
        {
          url: "https://img.example/a.png",
          posX: 50,
          posY: 50,
          scale,
          bgColor: "transparent",
          decoration: "none",
        },
        onUpdate,
      ),
      host,
    );
    const el = host.querySelector<HTMLElement>("#ft-avatar-preview")!;
    el.getBoundingClientRect = () => ({ width: 208, height: 208 }) as DOMRect;
    return el;
  }
  const pointer = (type: string, x: number, y: number, pointerId = 1) =>
    new PointerEvent(type, {
      clientX: x,
      clientY: y,
      pointerId,
      button: 0,
      bubbles: true,
      cancelable: true,
    });

  it("follows a touch or pen pointer, with the same maths as the mouse drag had", () => {
    const onUpdate = vi.fn();
    const el = preview(onUpdate);
    const capture = vi.fn();
    el.setPointerCapture = capture;
    expect(el.style.touchAction).toBe("none");

    el.dispatchEvent(pointer("pointerdown", 100, 100));
    expect(capture).toHaveBeenCalledWith(1);
    el.dispatchEvent(pointer("pointermove", 120, 90));
    // scale 150: sign -1, speed 10000/150; dx 20 → 50 - (20/208)*66.67 ≈ 44
    expect(onUpdate).toHaveBeenLastCalledWith({ posX: 44, posY: 53 });

    el.dispatchEvent(pointer("pointerup", 120, 90));
    onUpdate.mockClear();
    el.dispatchEvent(pointer("pointermove", 200, 200));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("a cancelled touch ends the drag too, and a second finger is ignored", () => {
    const onUpdate = vi.fn();
    const el = preview(onUpdate, 50);
    el.dispatchEvent(pointer("pointerdown", 100, 100, 7));
    el.dispatchEvent(pointer("pointermove", 110, 100, 8));
    expect(onUpdate).not.toHaveBeenCalled();
    el.dispatchEvent(pointer("pointermove", 110, 100, 7));
    // scale 50: sign +1, speed 200; dx 10 → 50 + (10/208)*200 ≈ 60
    expect(onUpdate).toHaveBeenLastCalledWith({ posX: 60, posY: 50 });
    el.dispatchEvent(pointer("pointercancel", 110, 100, 7));
    onUpdate.mockClear();
    el.dispatchEvent(pointer("pointermove", 150, 150, 7));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("a right press does not start a drag", () => {
    const onUpdate = vi.fn();
    const el = preview(onUpdate);
    el.dispatchEvent(new PointerEvent("pointerdown", { clientX: 1, clientY: 1, button: 2, pointerId: 1 }));
    el.dispatchEvent(pointer("pointermove", 90, 90));
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
