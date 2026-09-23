import { html, TemplateResult } from "lit-html";
import { cssUrl, sanitizeCssColor } from "../../../core/security/css-sanitize.ts";
import { localPreviewUrl } from "./local-preview.ts";

const TRANSPARENT = new Set(["transparent"]);

export interface AvatarEditorState {
  url: string;
  posX: number;
  posY: number;
  scale: number;
  bgColor: string;
  decoration: string;
}

const SCALE_MIN = 50;
const SCALE_MAX = 200;
const SCALE_STEP = 5;
const PREVIEW_SIZE = 208;

export function renderAvatarEditor(
  state: AvatarEditorState,
  onUpdate: (changes: Partial<AvatarEditorState>) => void,
): TemplateResult {
  const decoBoxShadow =
    state.decoration === "solid" ? "box-shadow: 0 0 0 4px #00babc;" : "";
  // A picked file not uploaded yet is previewed from a data: URL, which can
  // be megabytes. It sits in a custom property on a wrapper that no drag step
  // changes, so each step rewrites a short style instead of parsing it again.
  const local = localPreviewUrl(state.url);
  const image = local ? "var(--ft-avatar-local)" : cssUrl(state.url) || "none";

  // touch-action:none and pointer events: a finger drag scrolled the page
  // instead of moving the picture, which only listened to the mouse.
  return html`
    <div class="contents" style="${local ? `--ft-avatar-local:url("${local}")` : ""}">
      <div
        id="ft-avatar-preview"
        style="width:${PREVIEW_SIZE}px;height:${PREVIEW_SIZE}px;border-radius:9999px;background-image:${image};background-size:${state.scale}%;background-position:${state.posX}% ${state.posY}%;background-color:${sanitizeCssColor(state.bgColor, TRANSPARENT) || "transparent"};background-repeat:no-repeat;${decoBoxShadow}cursor:grab;flex-shrink:0;user-select:none;touch-action:none;"
        @pointerdown="${onPreviewPointerDown(onUpdate)}"
        @wheel="${onPreviewWheel(onUpdate, state)}"
      ></div>
    </div>
    <div class="w-full flex flex-col gap-2">
      <div class="flex items-center justify-between gap-1">
        <span class="text-xs opacity-60">Zoom</span>
        <div class="flex items-center gap-1">
          <button
            class="btn btn-xs btn-ghost"
            ?disabled="${state.scale <= SCALE_MIN}"
            @click="${() => {
              const s = Math.max(SCALE_MIN, state.scale - SCALE_STEP);
              if (s !== state.scale) onUpdate({ scale: s });
            }}"
          >
            −
          </button>
          <span class="text-xs font-mono w-10 text-center"
            >${state.scale}%</span
          >
          <button
            class="btn btn-xs btn-ghost"
            ?disabled="${state.scale >= SCALE_MAX}"
            @click="${() => {
              const s = Math.min(SCALE_MAX, state.scale + SCALE_STEP);
              if (s !== state.scale) onUpdate({ scale: s });
            }}"
          >
            +
          </button>
        </div>
      </div>
    </div>
  `;
}

function onPreviewPointerDown(
  onUpdate: (changes: Partial<AvatarEditorState>) => void,
) {
  return (e: PointerEvent) => {
    if (e.button !== 0) return;
    // Not stopped: the dialog's backdrop-close check has to see this press
    // start inside the editor (profile.modal.ts).
    e.preventDefault();

    const el = e.currentTarget as HTMLElement;
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    const rect = el.getBoundingClientRect();
    const size = rect.width || PREVIEW_SIZE;

    const style = el.getAttribute("style") || "";
    const scaleMatch = style.match(/background-size:\s*([\d.]+)%/);
    const posMatch = style.match(
      /background-position:\s*([\d.]+)%\s+([\d.]+)%/,
    );
    const startScale = scaleMatch ? parseFloat(scaleMatch[1]) : 100;
    const startPosX = posMatch ? parseFloat(posMatch[1]) : 50;
    const startPosY = posMatch ? parseFloat(posMatch[2]) : 50;

    const sign = startScale < 100 ? 1 : -1;
    const speed = 10000 / startScale;

    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moveEvent.preventDefault();
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;

      const dPosX = sign * (dx / size) * speed;
      const dPosY = sign * (dy / size) * speed;

      onUpdate({
        posX: Math.round(Math.max(0, Math.min(100, startPosX + dPosX))),
        posY: Math.round(Math.max(0, Math.min(100, startPosY + dPosY))),
      });
    };

    // Captured, the pointer keeps reporting to the preview once it leaves it
    // (a finger leaves it at once). Every way the drag can end removes the
    // listeners, a cancelled touch included.
    const onEnd = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerId) return;
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onEnd);
      el.removeEventListener("pointercancel", onEnd);
      el.removeEventListener("lostpointercapture", onEnd);
      el.style.cursor = "grab";
    };

    el.style.cursor = "grabbing";
    try {
      el.setPointerCapture?.(pointerId);
    } catch {
      // an id the browser no longer knows (the pointer already went up)
    }
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onEnd);
    el.addEventListener("pointercancel", onEnd);
    el.addEventListener("lostpointercapture", onEnd);
  };
}

function onPreviewWheel(
  onUpdate: (changes: Partial<AvatarEditorState>) => void,
  state: AvatarEditorState,
) {
  return (e: WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const delta = -Math.sign(e.deltaY) * SCALE_STEP;
    const newScale = Math.max(
      SCALE_MIN,
      Math.min(SCALE_MAX, state.scale + delta),
    );
    if (newScale !== state.scale) {
      onUpdate({ scale: newScale });
    }
  };
}
