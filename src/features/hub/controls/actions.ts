/**
 * The maintenance block of the Advanced tab: backup export and import, the
 * detected campus and the reload of its configuration, and Reset all data.
 * These are one-shot buttons, not stored settings.
 */
import { html } from "lit-html";
import { getConfig } from "../../../core/config.ts";
import { fetchCampusList } from "../../clusters/clusters.data.ts";
import { clearCampusConfigCache, loadCampusData } from "../../campus/campus.ts";
import { exportableSettings, sanitizeBackup } from "../backup.ts";
import type { HubSettingDef } from "../hubSettings.data.ts";
import type { LiveOptions } from "./context.ts";

export function renderAction(def: HubSettingDef) {
  const { actionType, actionLabel } = def as {
    actionType?: string;
    actionLabel?: string;
  };

  if (actionType === "backup") {
    return html`<div class="flex gap-2">
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

  if (actionType === "reload-campus") {
    return html`<button
      type="button"
      class="btn btn-sm btn-primary font-bold"
      @click="${() => void reloadCampusConfig()}"
    >
      ${actionLabel || "Reload"}
    </button>`;
  }

  return html`<button
    type="button"
    class="btn btn-sm btn-error font-bold"
    @click="${resetAllData}"
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
    const filtered = exportableSettings(items);
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
    try {
      const text = await file.text();
      // only known, non-sensitive, correctly typed keys are restored
      const data = sanitizeBackup(JSON.parse(text));
      await chrome.storage.local.set(data);
      location.reload();
    } catch {
      alert("Invalid backup file.");
    }
  };
  input.click();
}

/** Drops the cached campus configuration, fetches it again and reloads. */
async function reloadCampusConfig(): Promise<void> {
  const campusId = (await getConfig("CLUSTERS_CAMPUS")) || "";
  await clearCampusConfigCache(campusId);
  await fetchCampusList(true);
  if (campusId) await loadCampusData(campusId, true);
  location.reload();
}

/** Clears every Better Intra setting, after a confirmation, and reloads. */
function resetAllData(): void {
  if (
    confirm("This will clear ALL Better Intra settings and reload. Continue?")
  ) {
    void (async () => {
      await chrome.storage.local.clear();
      location.reload();
    })();
  }
}
