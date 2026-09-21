/**
 * The widget's own CSS, rendered as a <style> in its shadow root right after
 * the shared daisyUI sheet: placement of the floating button and dropdown,
 * the list-row grid and its narrow-screen layout, the medal glows of the
 * level podium and the rainbow badge animation. Kept out of the templates so
 * the render modules read as markup only.
 */
import { html } from "lit-html";

export const FRIENDS_WIDGET_STYLES = html`<style>
  :host {
    display: block;
  }

  @keyframes rainbow-shift {
    from {
      background-position: 200% 0;
    }
    to {
      background-position: 0% 0;
    }
  }

  .badge-rainbow {
    background: linear-gradient(
      90deg,
      #ff0000,
      #ff7f00,
      #ffeb3b,
      #4caf50,
      #00bcd4,
      #2196f3,
      #3f51b5,
      #9c27b0,
      #e91e63,
      #ff0000
    );
    background-size: 200% 100% !important;
    animation: rainbow-shift 5s linear infinite !important;
    border: none !important;
    color: white !important;
    text-shadow: 0px 1px 2px rgba(0, 0, 0, 0.2);
  }

  .medal-glow-gold,
  .medal-glow-silver,
  .medal-glow-bronze {
    box-sizing: content-box;
    border-width: 3px;
    border-style: solid;
    border-radius: 9999px;
  }
  .medal-glow-gold {
    --ft-medal-color: #ffd700;
    border-color: #ffd700;
    box-shadow:
      0 0 6px 2px rgba(255, 215, 0, 0.85),
      0 0 22px 8px rgba(255, 215, 0, 0.35);
  }
  .medal-glow-silver {
    --ft-medal-color: #d1d5da;
    border-color: #d1d5da;
    box-shadow:
      0 0 6px 2px rgba(209, 213, 218, 0.85),
      0 0 22px 8px rgba(209, 213, 218, 0.32);
  }
  .medal-glow-bronze {
    --ft-medal-color: #cd7f32;
    border-color: #cd7f32;
    box-shadow:
      0 0 6px 2px rgba(205, 127, 50, 0.85),
      0 0 22px 8px rgba(205, 127, 50, 0.32);
  }

  .friends-list .list-row [data-ft-level-badge] {
    border: 3px solid
      var(
        --ft-medal-color,
        color-mix(in oklab, var(--color-primary) 55%, transparent)
      );
  }

  .no-scrollbar {
    scrollbar-width: none;
  }
  .no-scrollbar::-webkit-scrollbar {
    display: none;
  }

  .friends-fab {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 9999;
  }

  .friends-fab .btn-circle {
    width: clamp(48px, 6vw, 72px) !important;
    height: clamp(48px, 6vw, 72px) !important;
    min-width: unset !important;
  }

  .friends-fab .swap {
    width: 30px;
    height: 30px;
  }

  .friends-fab .swap > * {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .friends-fab .swap-off svg {
    width: 100%;
    height: 100%;
  }

  .friends-dropdown {
    position: fixed;
    bottom: calc(clamp(48px, 6vw, 72px) + 32px);
    right: 24px;
    z-index: 9998;
    width: min(480px, calc(100vw - 48px));
    max-width: calc(100vw - 48px);
    max-height: min(640px, calc(100dvh - (clamp(48px, 6vw, 72px) + 96px)));
    display: flex;
    flex-direction: column;
    transform-origin: bottom right;
    transition:
      opacity 0.15s ease,
      transform 0.15s ease;
  }

  .friends-dropdown.closed {
    opacity: 0;
    pointer-events: none;
    transform: scale(0.95) translateY(8px);
  }

  .friends-list-wrap {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .friends-list {
    overflow-y: auto;
    flex: 1;
    scrollbar-width: thin;
    scrollbar-gutter: stable;
    padding-bottom: 4rem;
  }

  .friends-actions {
    position: absolute;
    right: 0.75rem;
    bottom: 0.75rem;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.5rem;
    padding: 0.5rem;
    border-radius: 0.75rem;
    background: var(--color-base-100);
    border: 1px solid
      color-mix(in oklab, var(--color-base-content) 10%, transparent);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
    z-index: 30;
  }

  .friends-add-expand {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    transition:
      opacity 0.15s ease,
      transform 0.15s ease;
  }

  .friends-delete-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .friends-list .list-row {
    padding-block: 0.75rem;
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-rows: repeat(3, auto);
    min-width: 0;
    column-gap: 0.75rem;
    row-gap: 0.25rem;
    align-items: stretch;
  }

  .friends-list .list > :not(:last-child).list-row:after {
    border-color: color-mix(
      in oklab,
      var(--color-base-content) 15%,
      transparent
    );
  }

  .friends-list .list-row [data-ft-avatar-col] {
    grid-column: 1;
    grid-row: 1 / 3;
    align-self: center;
  }

  .friends-list .list-row [data-ft-level-badge] {
    grid-column: 1;
    grid-row: 3;
    justify-self: center;
    align-self: center;
  }

  .friends-list .list-row [data-ft-info] {
    display: contents;
  }

  .friends-list .list-row [data-ft-row="name"] {
    grid-column: 2;
    grid-row: 1;
  }

  .friends-list .list-row [data-ft-row="meta"] {
    grid-column: 2;
    grid-row: 2;
  }

  .friends-list .list-row [data-ft-row="level"] {
    grid-column: 2;
    grid-row: 3;
    align-self: center;
  }

  .friends-list .list-row [data-ft-stats-col] {
    grid-column: 3;
    grid-row: 1 / 4;
    align-self: center;
  }

  .friends-list .list-row [data-ft-delete-col] {
    grid-column: 4;
    grid-row: 1 / 4;
    align-self: center;
  }

  @media (max-width: 520px) {
    .friends-dropdown {
      right: 12px;
      left: 12px;
      width: auto;
      max-width: none;
      bottom: calc(clamp(48px, 6vw, 72px) + 20px);
      max-height: calc(100dvh - (clamp(48px, 6vw, 72px) + 48px));
      border-radius: 1.25rem;
      transform-origin: bottom center;
    }

    .friends-fab {
      right: 16px;
      bottom: 16px;
    }

    .friends-list .list {
      gap: 0;
    }

    .friends-list .list-row {
      grid-template-columns: auto minmax(0, 1fr);
      grid-template-rows: repeat(4, auto);
    }

    .friends-list .list-row [data-ft-stats-col] {
      grid-column: 2;
      grid-row: 4;
      flex-direction: row;
      justify-content: flex-start;
      align-self: start;
    }

    .friends-list .list-row:has([data-ft-delete-col]) {
      grid-template-columns: auto minmax(0, 1fr) auto;
    }

    .friends-list .list-row [data-ft-delete-col] {
      grid-column: 3;
      grid-row: 1 / 5;
    }

    .friends-list .list-row [data-ft-avatar-col] .w-14 {
      width: 3rem;
      height: 3rem;
    }
  }

  @media (max-width: 380px) {
    .friends-list .list-row .badge-md {
      font-size: 0.625rem;
      padding: 0.125rem 0.5rem;
    }
  }
</style>`;
