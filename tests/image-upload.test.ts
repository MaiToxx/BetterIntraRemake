/**
 * Uploading a profile image from the editor: the file goes to the worker as
 * raw bytes with the session, and the served URL lands in the URL field.
 * Before 1.13.2 the only way in was pasting a link to an image hosted
 * elsewhere.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "lit-html";
import { uploadProfileImage, MAX_UPLOAD_BYTES } from "../src/features/profile/header/image-upload";
import { renderUrlField } from "../src/features/profile/header/profile-modal-form";

const png = (size = 16, type = "image/png") =>
  new File([new Uint8Array(size)], "me.png", { type });

beforeEach(async () => {
  await chrome.storage.local.clear();
  await chrome.storage.local.set({ CLOUD_LOGIN: "alice", CLOUD_TOKEN: "sess" });
});
afterEach(() => vi.unstubAllGlobals());

describe("uploadProfileImage", () => {
  it("posts the bytes with the session and returns the served URL", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toMatch(/\/api\/v1\/private\/images\?slot=banner&login=[a-f0-9]{64}$/);
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sess");
      expect((init.headers as Record<string, string>)["Content-Type"]).toBe("image/png");
      expect(init.body).toBeInstanceOf(Blob);
      return new Response(JSON.stringify({ url: "https://w.test/img/abc/banner?v=1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await uploadProfileImage("banner", png());
    expect(r).toEqual({ ok: true, url: "https://w.test/img/abc/banner?v=1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a wrong type or an oversized file before any request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await uploadProfileImage("avatar", png(16, "image/svg+xml"))).ok).toBe(false);
    expect((await uploadProfileImage("avatar", png(MAX_UPLOAD_BYTES + 1))).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks to connect when signed out, and names a server refusal", async () => {
    await chrome.storage.local.remove(["CLOUD_TOKEN"]);
    const out = await uploadProfileImage("avatar", png());
    expect(out.ok).toBe(false);
    expect((out as { error: string }).error).toMatch(/Sign in with 42/);

    await chrome.storage.local.set({ CLOUD_TOKEN: "sess" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("too big", { status: 413 })));
    expect((await uploadProfileImage("avatar", png())).ok).toBe(false);
  });

  it("says when to try again after the worker's daily budget or a busy key (both 503)", async () => {
    const refuse = (error: string) =>
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          new Response(JSON.stringify({ error, message: "refused" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );
    refuse("daily_write_budget");
    const spent = await uploadProfileImage("avatar", png());
    expect((spent as { error: string }).error).toMatch(/saves for today are used up\. Try again after/);
    refuse("kv_busy");
    const busy = await uploadProfileImage("avatar", png());
    expect((busy as { error: string }).error).toMatch(/busy: try again in a few seconds/);
    // any other 503 keeps the status sentence
    refuse("server_error");
    const other = await uploadProfileImage("avatar", png());
    expect((other as { error: string }).error).toBe("Upload failed (503).");
  });
});

describe("the URL field's Upload button", () => {
  it("hands the chosen file to the upload handler and shows its status", () => {
    const onFile = vi.fn();
    const host = document.createElement("div");
    render(renderUrlField("Image URL", "", () => {}, [], undefined, { onFile }), host);
    const input = host.querySelector<HTMLInputElement>("[data-upload-input]")!;
    expect(input.accept).toContain("image/png");
    const file = png();
    Object.defineProperty(input, "files", { value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onFile).toHaveBeenCalledWith(file);

    render(
      renderUrlField("Image URL", "", () => {}, [], undefined, {
        onFile,
        status: "Uploading me.png…",
        busy: true,
      }),
      host,
    );
    expect(host.querySelector("[data-upload-status]")?.textContent).toContain("Uploading");
    expect(host.querySelector<HTMLInputElement>("[data-upload-input]")!.disabled).toBe(true);
  });

  it("is absent from fields that do not offer uploads", () => {
    const host = document.createElement("div");
    render(renderUrlField("Image URL", "", () => {}), host);
    expect(host.querySelector("[data-upload-input]")).toBeNull();
  });
});
