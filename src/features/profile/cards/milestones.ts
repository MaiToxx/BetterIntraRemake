import { getConfig } from "../../../core/config.ts";

const STYLE_ID = "fire-milestone-style";
/** On <html> while "Disable animations" is on: stops the ring, as freeze.ts does. */
const STILL_CLASS = "ft-fire-still";

export function initMilestones() {
  injectMilestoneStyles();
  enhanceMilestones();
}

// No retry here: the profile pass calls initMilestones again on every burst
// of Intra mutations, so the milestones are decorated once React renders them.
function enhanceMilestones() {
  const validated = document.querySelectorAll<HTMLElement>(
    ".bg-legacy-main.h-10[data-state]",
  );
  const muted = document.querySelectorAll<HTMLElement>(
    ".bg-legacy-main-muted.h-10[data-state]",
  );

  validated.forEach((el) => {
    if (el.dataset.fireBg) return;
    el.dataset.fireBg = "true";
    el.classList.add("fire-bg");
  });

  if (muted.length > 0) {
    const current = muted[0];
    if (!current.dataset.fireAnimated) {
      current.dataset.fireAnimated = "true";
      current.classList.add("fire-animated");
    }
  }
}

function injectMilestoneStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  // The ring used to be turned by a requestAnimationFrame loop writing
  // --angle 60 times a second for as long as the dashboard was open. A
  // registered custom property lets CSS animate the gradient's start angle
  // instead: no script per frame, and it stops under the motion settings.
  // One turn per 2.5 s is the speed the loop had (2.4deg per frame at 60 fps).
  style.textContent = `
    @property --angle {
      syntax: "<angle>";
      inherits: false;
      initial-value: 0deg;
    }

    @keyframes ft-fire-spin {
      to { --angle: 360deg; }
    }

    .fire-bg.h-10 {
      position: relative;
      overflow: hidden;
      isolation: isolate;
      border-radius: 4px;
      background:
        linear-gradient(
          135deg,
          #ff6a00 0%,
          #ff8c00 40%,
          #ff9f1c 100%
        ) !important;
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,0.15),
        inset 0 -8px 18px rgba(0,0,0,0.18);
    }

    .fire-animated.h-10 {
      position: relative;
      overflow: hidden;
      isolation: isolate;
      border-radius: 4px;
    }

    .fire-animated::before {
      content: "";
      position: absolute;
      inset: 0;
      padding: 4px;
      border-radius: inherit;
      background:
        conic-gradient(
          from var(--angle, 0deg),
          #ff3c00,
          #ff7b00,
          #ffd000,
          #ff7b00,
          #ff3c00
        );
      -webkit-mask:
        linear-gradient(#000 0 0) content-box,
        linear-gradient(#000 0 0);
      -webkit-mask-composite: xor;
      mask-composite: exclude;
      z-index: 3;
      pointer-events: none;
      animation: ft-fire-spin 2.5s linear infinite;
    }

    @media (prefers-reduced-motion: reduce) {
      .fire-animated::before { animation: none; }
    }
    html.${STILL_CLASS} .fire-animated::before { animation: none; }

    .fire-animated > * {
      position: relative;
      z-index: 2;
    }

    div:has(> .bg-red-500.rounded-full.h-3.w-3) {
      position: relative;
      z-index: 1;
      margin-top: -5rem !important;
    }

    .bg-red-500.rounded-full + .w-\\[2px\\] {
      height: 75px;
    }

    .h-\\[59\\%\\].justify-between {
      justify-content: flex-start;
      padding-bottom: 0 !important;
    }
  `;
  document.head.appendChild(style);
  void getConfig("DISABLE_ANIMATIONS").then((disabled) => {
    if (disabled) document.documentElement.classList.add(STILL_CLASS);
  });
}
