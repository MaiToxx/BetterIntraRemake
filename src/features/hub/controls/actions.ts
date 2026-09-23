/**
 * The maintenance block of the Advanced tab: backup export and import, the
 * detected campus and the reload of its configuration, and Reset all data.
 * These are one-shot buttons, not stored settings.
 */
import { html, nothing } from "lit-html";
import { getConfig } from "../../../core/config.ts";
import { logoutCloud } from "../../account/account.ts";
import { fetchCampusList } from "../../clusters/clusters.data.ts";
import { loadCampusData } from "../../campus/campus.ts";
import {
  backupSensitiveKeys,
  exportableSettings,
  sanitizeBackup,
  unwrapBackup,
  wrapBackup,
} from "../backup.ts";
import { HUB_INFO, type HubSettingDef } from "../hubSettings.data.ts";
import { settingIds, type LiveOptions } from "./context.ts";

export function renderAction(def: HubSettingDef) {
  const { actionType, actionLabel } = def as {
    actionType?: string;
    actionLabel?: string;
  };
  const ids = settingIds(def);
  const desc = ids.desc ?? nothing;

  if (actionType === "backup") {
    // Two buttons, each named by its own word, under the setting's label.
    return html`<div
      class="flex gap-2"
      role="group"
      aria-labelledby="${ids.label}"
      aria-describedby="${desc}"
    >
      <button
        type="button"
        class="btn btn-sm btn-primary font-bold"
        @click="${exportBackup}"
      >
        Export
      </button>
      <button
        type="button"
        class="btn btn-sm btn-primary font-bold"
        @click="${importBackup}"
      >
        Import
      </button>
    </div>`;
  }

  // A lone "Reload" or "Reset" says too little: the button is named by the
  // setting's label ("Reload campus config", "Reset all data"), which keeps
  // the visible word for voice control.
  if (actionType === "reload-campus") {
    // The outcome is written under the button: a failed fetch used to leave
    // no trace on screen (and no page reload to hint at it).
    return html`<div class="flex flex-col items-end gap-1">
      <button
        type="button"
        class="btn btn-sm btn-primary font-bold"
        aria-labelledby="${ids.label}"
        aria-describedby="${desc}"
        @click="${(e: Event) => void reloadCampusConfig(e.currentTarget as HTMLButtonElement)}"
      >
        ${actionLabel || "Reload"}
      </button>
      <p class="text-xs text-error hidden" role="status" data-campus-reload-status></p>
    </div>`;
  }

  return html`<button
    type="button"
    class="btn btn-sm btn-error font-bold"
    aria-labelledby="${ids.label}"
    aria-describedby="${desc}"
    @click="${() => void resetAllData()}"
  >
    ${actionLabel || "Reset"}
  </button>`;
}

/** The campus the 42 API reported, named from the campus manifest. */
export async function renderCampusInfo(live: LiveOptions) {
  const campusId = await getConfig("CLUSTERS_CAMPUS");
  const campusName = campusId
    ? live.campuses.find((c) => c.value === campusId)?.label || campusId
    : "Not detected";
  return html`<span class="badge badge-info badge-lg text-base"
    >${campusName}</span
  >`;
}

/** Downloads the settings as a dated JSON file. */
function exportBackup(): void {
  chrome.storage.local.get(null, (items) => {
    // never write credentials (cloud token, calendar secret...) to disk
    const filtered = wrapBackup(exportableSettings(items), HUB_INFO.version);
    const blob = new Blob([JSON.stringify(filtered, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const n = new Date();
    a.download = `better-intra-settings-${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}_${String(n.getHours()).padStart(2, "0")}-${String(n.getMinutes()).padStart(2, "0")}-${String(n.getSeconds()).padStart(2, "0")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

/** Asks for a backup file, restores it and reloads the page. */
function importBackup(): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    let data: Record<string, unknown>;
    let summary: string;
    try {
      const text = await file.text();
      const backup = unwrapBackup(JSON.parse(text));
      // only known, non-sensitive, correctly typed keys are restored
      data = sanitizeBackup(backup.settings);
      summary = describeBackup(Object.keys(data).length, backup);
    } catch {
      alert("Invalid backup file.");
      return;
    }
    if (!(await confirmBackupImport(data, summary))) return;
    await chrome.storage.local.set(data);
    location.reload();
  };
  input.click();
}

/** "12 settings exported on 3 Sep 2026 (v1.12.1)" for the confirmation. */
export function describeBackup(
  count: number,
  meta: { version?: string; exportedAt?: string },
): string {
  const when = meta.exportedAt ? new Date(meta.exportedAt) : null;
  const date =
    when && !Number.isNaN(when.getTime())
      ? ` exported on ${when.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}`
      : "";
  const version = meta.version ? ` (v${meta.version})` : "";
  return `${count} setting${count === 1 ? "" : "s"}${date}${version}`;
}

/**
 * Restoring overwrites the current settings at once and reloads, so it asks
 * first, like Reset all data. The custom CSS and the public profile fields
 * of a file made by someone else get a question of their own: on "no" they
 * are left out of `data`.
 */
export async function confirmBackupImport(
  data: Record<string, unknown>,
  summary: string,
  ask: (message: string) => boolean = (m) => window.confirm(m),
): Promise<boolean> {
  if (!ask(`Restore ${summary}? Your current settings will be overwritten.`)) {
    return false;
  }
  const sensitive = backupSensitiveKeys(data);
  if (sensitive.length > 0) {
    const keep = ask(
      "This backup also contains custom CSS or public profile fields (bio, status, links). Only restore them if you made this backup yourself. Restore them too?",
    );
    if (!keep) for (const key of sensitive) delete data[key];
  }
  return true;
}

/**
 * Fetches the campus configuration again and reloads. The cache is not
 * dropped first: a forced fetch overwrites it on success, and while the
 * worker is unreachable the copy of an hour ago is all the page has.
 */
export async function reloadCampusConfig(
  button?: HTMLButtonElement | null,
): Promise<void> {
  const status = button?.parentElement?.querySelector<HTMLElement>(
    "[data-campus-reload-status]",
  );
  if (button) {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
  }
  status?.classList.add("hidden");
  try {
    const campusId = (await getConfig("CLUSTERS_CAMPUS")) || "";
    await fetchCampusList(true);
    if (campusId) await loadCampusData(campusId, true);
    location.reload();
  } catch (e) {
    console.warn("Campus configuration reload failed", e);
    if (status) {
      status.textContent =
        "Could not reach the campus configuration; kept the current one.";
      status.classList.remove("hidden");
    }
    if (button) {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  }
}

/**
 * Clears every Better Intra setting, after a confirmation, and reloads.
 *
 * The question used to say "settings" only: the reset also signs out, and
 * the shortcuts, friends list and calendar link that were never pushed are
 * gone for good. Signed in, the session is revoked on the worker first
 * (logoutCloud keeps the cloud copy), instead of being left to hold one of
 * the account's ten session slots.
 */
export async function resetAllData(
  ask: (message: string) => boolean = (m) => window.confirm(m),
): Promise<void> {
  const signedIn = !!(await chrome.storage.local.get("CLOUD_TOKEN")).CLOUD_TOKEN;
  const message = signedIn
    ? "Reset all data? This clears every Better Intra setting on this browser and signs you out. What was never pushed to the cloud (shortcuts, friends list, calendar link) is lost; your cloud copy stays, and is offered back when you sign in again."
    : "Reset all data? This clears every Better Intra setting on this browser, shortcuts, friends list and calendar link included. Export first to keep a copy.";
  if (!ask(message)) return;
  if (signedIn) {
    try {
      await logoutCloud();
    } catch {
      /* the local reset goes on: the worker drops the session in time */
    }
  }
  await chrome.storage.local.clear();
  location.reload();
}
