/**
 * The hub panels drawn outside the generic setting renderers (tests/hub-a11y
 * covers those): the shortcut editor, the preset bar and the per-card colours.
 * Every control must have a name that says what it edits; a placeholder is not
 * one, and a <label> only names its first control.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { render } from "lit-html";
import { renderShortcutsSettings } from "../src/features/shortcuts/shortcuts.ui";
import { renderCardsPanel } from "../src/features/customize/cards.ui";
import { renderPresetsPanel } from "../src/features/customize/presets.ui";

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 2));
};

/** The accessible name, as far as these panels need it. */
function nameOf(el: HTMLElement): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria.trim();
  const by = el.getAttribute("aria-labelledby");
  if (by) return by.split(" ").map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
  const label = el.closest("label");
  if (label && label.querySelector("input, select, textarea, button") === el) {
    return (label.textContent ?? "").trim();
  }
  if (el.tagName === "BUTTON") {
    // text a screen reader reads (aria-hidden parts left out)
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("[aria-hidden='true']").forEach((n) => n.remove());
    return (clone.textContent ?? "").trim();
  }
  return "";
}

function controls(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("input, select, textarea, button")];
}

let host: HTMLElement;
beforeEach(async () => {
  // the panels follow storage changes; the shared chrome stub has no events
  (chrome.storage as unknown as { onChanged?: unknown }).onChanged ??= {
    addListener() {},
    removeListener() {},
  };
  await chrome.storage.local.clear();
  document.body.replaceChildren();
  host = document.createElement("div");
  document.body.appendChild(host);
});

describe("shortcut editor", () => {
  it("names every field after its shortcut", () => {
    const links = [
      { name: "Intra", url: "https://intra.42.fr", color: "#00babc", emoji: "🐝" },
      { name: "", url: "", color: "#ff0000", emoji: "" },
    ];
    render(
      renderShortcutsSettings(links, () => {}, () => {}, () => {}, () => {}, () => {}),
      host,
    );
    const rows = host.querySelectorAll(".link-group");
    expect(rows.length).toBe(2);
    const names = controls(rows[1]).map(nameOf);
    expect(names).toEqual([
      "Shortcut 2 emoji",
      "Shortcut 2 name",
      "Shortcut 2 address",
      "Shortcut 2 colour",
      "Remove shortcut 2",
    ]);
    for (const el of controls(host)) expect(nameOf(el), el.outerHTML).not.toBe("");
  });
});

describe("per-card colours", () => {
  it("names each colour and switch after its card", async () => {
    render(renderCardsPanel(), host);
    await flush();
    const all = controls(host);
    expect(all.length).toBeGreaterThan(18);
    for (const el of all) expect(nameOf(el), el.outerHTML).not.toBe("");
    const names = all.map(nameOf);
    expect(names).toContain("Background colour for Logtime");
    expect(names).toContain("Custom background colour for Logtime");
    expect(names).toContain("Glow on Logtime");
    expect(names).toContain("Clear the Logtime look");
    // no two controls share a name
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("presets", () => {
  it("names the preset field", async () => {
    render(renderPresetsPanel(), host);
    await flush();
    const field = host.querySelector<HTMLElement>("[data-preset-name]");
    expect(field).not.toBeNull();
    expect(nameOf(field!)).toBe("Preset name");
    for (const el of controls(host)) expect(nameOf(el), el.outerHTML).not.toBe("");
  });
});
