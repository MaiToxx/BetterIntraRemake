/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://profile-v3.intra.42.fr/" }
 *
 * initTranscript() runs on every profile pass. With a campus file that has no
 * transcripts (every campus but Belgium) it used to force an uncached reload of
 * the manifest and the campus file on each pass, and write both back to
 * storage; with transcripts it spawned an unbounded animation-frame loop per
 * pass. Now the campus file is read once per page, from the cache, and the
 * button is repaired by the next pass with one synchronous lookup.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/** The transcripts memo is per page (module state): a fresh module per test. */
async function loadModule() {
  vi.resetModules();
  return import("../src/features/profile/cards/transcript.ts");
}

const FRESH = { clusters: [{ id: "k0", name: "k0" }], definitions: {} };
const WITH_TRANSCRIPTS = {
  ...FRESH,
  transcripts: [{ cursusLabel: "42cursus", records: [{ label: "EN", sr_id: 1 }] }],
};

const setCalls = () => vi.mocked(chrome.storage.local.set).mock.calls.length;

async function seed(data: object) {
  await chrome.storage.local.set({
    CLOUD_LOGIN: "bob",
    CLOUD_TOKEN: "tok",
    CLUSTERS_CAMPUS: "7",
    CAMPUS_MANIFEST_V2: {
      manifest: { campuses: [{ id: "7", name: "Mulhouse" }] },
      timestamp: Date.now(),
    },
    CAMPUS_DATA_7: { data, timestamp: Date.now() },
  });
  vi.mocked(chrome.storage.local.set).mockClear();
}

function mountProjectsCard(): HTMLElement {
  const card = document.createElement("div");
  card.className = "bg-white md:h-96";
  const title = document.createElement("span");
  title.className = "uppercase";
  title.textContent = "Projects";
  const inner = document.createElement("div");
  inner.className = "flex flex-col w-full h-full";
  card.append(title, inner);
  document.body.appendChild(card);
  return card;
}

beforeEach(async () => {
  await chrome.storage.local.clear();
  document.body.replaceChildren();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => FRESH })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("initTranscript", () => {
  it("costs no fetch and no storage write across passes when the campus has no transcripts", async () => {
    const { initTranscript } = await loadModule();
    await seed(FRESH);
    for (let i = 0; i < 5; i++) await initTranscript();
    // Before: 5 passes = 10 `no-store` fetches and 10 storage writes.
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(setCalls()).toBe(0);
  });

  it("reads the campus file once per page and re-injects the button without a frame loop", async () => {
    const { initTranscript } = await loadModule();
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "setTimeout"] });
    await seed(WITH_TRANSCRIPTS);
    // No Projects card yet: the pass must not leave an animation frame pending.
    await initTranscript();
    expect(vi.getTimerCount()).toBe(0);

    const readsBefore = vi.mocked(chrome.storage.local.get).mock.calls.filter(
      ([k]) => k === "CAMPUS_DATA_7",
    ).length;
    mountProjectsCard();
    await initTranscript();
    expect(document.querySelector("[data-ft-transcript]")).not.toBeNull();

    // React re-mounts the card: the next pass repairs it, from memory.
    document.body.replaceChildren();
    mountProjectsCard();
    await initTranscript();
    expect(document.querySelectorAll("[data-ft-transcript]")).toHaveLength(1);
    const readsAfter = vi.mocked(chrome.storage.local.get).mock.calls.filter(
      ([k]) => k === "CAMPUS_DATA_7",
    ).length;
    expect(readsAfter).toBe(readsBefore);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("shows without the cloud sign-in, and posts the transcript form for the page's login", async () => {
    const { initTranscript } = await loadModule();
    await seed(WITH_TRANSCRIPTS);
    // The download is a form POST with the student's own Intra cookies: no
    // worker session is involved.
    await chrome.storage.local.remove(["CLOUD_LOGIN", "CLOUD_TOKEN"]);
    const own = document.createElement("span");
    own.setAttribute("data-login", "");
    own.textContent = "carol";
    document.body.appendChild(own);
    mountProjectsCard();

    await initTranscript();
    const btn = document.querySelector<HTMLElement>("[data-ft-transcript]");
    expect(btn, "the button needs no sign-in").not.toBeNull();

    // jsdom has neither showModal() / close() nor form submission.
    const dialogProto = HTMLDialogElement.prototype as unknown as {
      showModal: () => void;
      close: () => void;
    };
    const { showModal, close } = dialogProto;
    dialogProto.showModal = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    dialogProto.close = function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
    let action = "";
    const submit = vi
      .spyOn(HTMLFormElement.prototype, "submit")
      .mockImplementation(function (this: HTMLFormElement) {
        action = this.action;
      });
    try {
      btn!.click();
      const download = await vi.waitFor(() => {
        const root = document.querySelector("#ft-transcript-dialog div")!.shadowRoot!;
        const b = [...root.querySelectorAll<HTMLButtonElement>("button")].find((x) =>
          x.textContent?.includes("Download"),
        );
        expect(b).toBeDefined();
        return b!;
      });
      download.click();
      expect(action).toBe(
        "https://projects.intra.42.fr/users/carol/transcripts/1/generate.pdf",
      );
    } finally {
      submit.mockRestore();
      Object.assign(dialogProto, { showModal, close });
    }
  });
});
