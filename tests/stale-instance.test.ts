/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://profile-v3.intra.42.fr/" }
 */
/**
 * After a Firefox add-on update the new content.js is injected into the open
 * Intra tabs while the old instance's DOM stays, listeners dead. The new
 * instance used to keep the dead gear and Clusters button (their mounts are
 * guarded by id) and to add a second friends widget and theme link (guarded
 * per instance). stale-instance.ts clears those leftovers first.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  INSTANCE_ATTR,
  claimPage,
  hasStaleInstance,
  removeStaleInstance,
} from "../src/core/lifecycle/stale-instance.ts";
import { OWN_ID_PREFIXES, isOwnId } from "../src/core/lifecycle/own-ids.ts";
import { mountGearButton } from "../src/features/hub/hubSettings.ts";

const el = (tag: string, attrs: Record<string, string> = {}, parent: Element = document.body) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent.appendChild(node);
  return node;
};

/** The Intra's own markup: none of it may be removed. */
const intraPage = () => {
  const root = el("div", { id: "root" });
  const sidebar = el("div", { class: "flex flex-col w-full" }, root);
  el("a", { href: "https://profile-v3.intra.42.fr" }, sidebar);
  const card = el("div", { "data-ft-card": "marks", id: "marks-card" }, root);
  const avatar = el("div", { class: "rounded-full w-52 h-52" }, root);
  const paceRow = el("div", { class: "flex flex-row items-center" }, root);
  const bar = el("div", {}, paceRow);
  const agenda = el("div", {}, root);
  const projects = el("div", {}, root);
  const container = el("div", {}, root);
  return { root, sidebar, card, avatar, paceRow, bar, agenda, projects, container };
};

/** What 1.11.1 leaves behind when Firefox replaces it (no INSTANCE_ATTR yet). */
const oldInstance = (page: ReturnType<typeof intraPage>) => {
  const gear = el("a", { id: "hub-gear-btn", href: "#" }, page.sidebar);
  const clusters = el("a", { id: "ft-clusters-btn", href: "#" }, page.sidebar);
  el("div", { id: "friends-widget-host" });
  el("div", { id: "logtime-shadow-wrapper" }, page.root);
  el("div", { id: "profile-badges-shadow" }, page.root);
  el("dialog", { id: "cluster-map-dialog" });
  el("div", { id: "cluster-shadow-host" });
  // Theme links: the enabled one has the id, a disabled one lost it, and the
  // light-preset overrides never had one.
  el("link", { rel: "stylesheet", id: "better-intra-theme-stylesheet", "data-better-intra-theme": "darkV3" }, document.head);
  el("link", { rel: "stylesheet", media: "not all", "data-better-intra-theme": "lightV3" }, document.head);
  el("link", { rel: "stylesheet", "data-better-intra-theme": "lightPresetOverrides" }, document.head);
  el("style", { id: "better-intra-theme-preset" }, document.head);
  el("style", { id: "better-intra-customize" }, document.head);
  el("style", { id: "better-intra-perf" }, document.head);
  el("style", { id: "ft-profile-extras-style" }, document.head);
  el("style", { id: "ft-profile-host-styles" }, document.head);
  // Controls injected into the Intra's containers, marked by an attribute.
  el("button", { "data-ft-friend": "" }, page.container);
  el("button", { "data-ft-transcript": "" }, page.projects);
  el("span", { "data-ft-give-points": "" }, page.card);
  // "Already bound" flags on the Intra's own nodes.
  page.paceRow.setAttribute("data-ft-days-toggle", "true");
  page.bar.setAttribute("data-ft-pace-listener", "true");
  page.avatar.setAttribute("data-modal-listener", "true");
  page.agenda.setAttribute("data-filter-injected", "true");
  return { gear, clusters };
};

const setReadyState = (state: DocumentReadyState) =>
  Object.defineProperty(document, "readyState", { configurable: true, get: () => state });

beforeEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
  document.documentElement.removeAttribute(INSTANCE_ATTR);
  setReadyState("complete");
});

afterEach(() => {
  delete (document as { readyState?: unknown }).readyState;
  window.dispatchEvent(new Event("pagehide"));
});

describe("claimPage after an update", () => {
  it("removes the old instance's nodes, and only those", () => {
    const page = intraPage();
    oldInstance(page);

    claimPage();

    for (const sel of [
      "#hub-gear-btn",
      "#ft-clusters-btn",
      "#friends-widget-host",
      "#logtime-shadow-wrapper",
      "#profile-badges-shadow",
      "#cluster-map-dialog",
      "#cluster-shadow-host",
      "link[data-better-intra-theme]",
      "#better-intra-theme-preset",
      "#better-intra-customize",
      "#better-intra-perf",
      "#ft-profile-extras-style",
      "#ft-profile-host-styles",
      "[data-ft-friend]",
      "[data-ft-transcript]",
      "[data-ft-give-points]",
    ]) {
      expect(document.querySelectorAll(sel), sel).toHaveLength(0);
    }
    // The Intra's own nodes are all still there.
    for (const node of Object.values(page)) expect(node.isConnected).toBe(true);
    expect(page.card.getAttribute("data-ft-card")).toBe("marks");
  });

  it("strips the flags that would stop the new instance from binding again", () => {
    const page = intraPage();
    oldInstance(page);

    claimPage();

    expect(page.paceRow.hasAttribute("data-ft-days-toggle")).toBe(false);
    expect(page.bar.hasAttribute("data-ft-pace-listener")).toBe(false);
    expect(page.avatar.hasAttribute("data-modal-listener")).toBe(false);
    expect(page.agenda.hasAttribute("data-filter-injected")).toBe(false);
  });

  it("marks the page, so the next instance knows without any evidence", () => {
    claimPage();
    expect(document.documentElement.hasAttribute(INSTANCE_ATTR)).toBe(true);

    // A later build finds only the marker and a node the evidence list does
    // not name: it still clears it.
    el("div", { id: "ft-roulette-card" });
    expect(hasStaleInstance()).toBe(true);
    claimPage();
    expect(document.getElementById("ft-roulette-card")).toBeNull();
  });

  it("lets the new instance mount a working gear instead of keeping the dead one", () => {
    const page = intraPage();
    const { gear } = oldInstance(page);

    // Without the cleanup: the id guard keeps the dead node.
    mountGearButton();
    expect(document.getElementById("hub-gear-btn")).toBe(gear);

    claimPage();
    mountGearButton();
    const fresh = document.getElementById("hub-gear-btn");
    expect(fresh).not.toBeNull();
    expect(fresh).not.toBe(gear);
    expect(document.querySelectorAll("#hub-gear-btn")).toHaveLength(1);
  });
});

describe("claimPage leaves a page alone when there was no earlier instance", () => {
  it("normal page load (document_start): never touches the page", () => {
    const page = intraPage();
    oldInstance(page);
    setReadyState("loading");
    document.documentElement.setAttribute(INSTANCE_ATTR, "");

    claimPage();

    expect(document.getElementById("hub-gear-btn")).not.toBeNull();
    expect(page.paceRow.hasAttribute("data-ft-days-toggle")).toBe(true);
    expect(document.documentElement.hasAttribute(INSTANCE_ATTR)).toBe(true);
  });

  it("first install into an open tab: no evidence, nothing removed", () => {
    const page = intraPage();
    // An Intra node that happens to match one of our prefixes.
    const lookalike = el("div", { id: "hub-intra-own" }, page.root);

    expect(hasStaleInstance()).toBe(false);
    claimPage();

    expect(lookalike.isConnected).toBe(true);
    expect(document.documentElement.hasAttribute(INSTANCE_ATTR)).toBe(true);
  });

  it("a failing cleanup never stops the start-up", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const spy = vi.spyOn(document, "querySelectorAll").mockImplementation(() => {
      throw new Error("boom");
    });
    el("a", { id: "hub-gear-btn" });
    expect(() => claimPage()).not.toThrow();
    expect(document.documentElement.hasAttribute(INSTANCE_ATTR)).toBe(true);
    spy.mockRestore();
    warn.mockRestore();
  });
});

describe("removeStaleInstance", () => {
  it("reports how many nodes it removed", () => {
    el("a", { id: "hub-gear-btn" });
    el("div", { id: "friends-widget-host" });
    el("div", { id: "root" });
    expect(removeStaleInstance()).toBe(2);
  });
});

describe("shared id list", () => {
  it("covers the friends host, the gear and our sheets", () => {
    for (const id of [
      "friends-widget-host",
      "hub-gear-btn",
      "ft-clusters-btn",
      "better-intra-theme-stylesheet",
      "better-intra-customize",
      "better-intra-perf",
      "ft-profile-extras-style",
    ]) {
      expect(isOwnId(id), id).toBe(true);
    }
    expect(isOwnId("root")).toBe(false);
    expect(isOwnId("")).toBe(false);
    expect(OWN_ID_PREFIXES.length).toBeGreaterThan(0);
  });
});

describe("main.ts", () => {
  it("imports the cleanup before anything else", () => {
    // Module bodies run in import order: any import above it could add a node
    // (or read a stale one) before the leftovers are gone.
    const src = fs.readFileSync(path.resolve(__dirname, "../src/main.ts"), "utf8");
    const firstImport = src.match(/^import\s[^;]*;/m)?.[0];
    expect(firstImport).toBe('import "./core/lifecycle/stale-instance.ts";');
  });
});
