import { getConfig } from "../../core/config.ts";

export interface TranscriptEntry {
  cursusLabel: string;
  records: { label: string; sr_id: number }[];
}

export type ExitArrowDir = "up" | "right" | "down" | "left";

export interface ExitSign {
  x: number | string;
  y: number | string;
  w?: number | string;
  h?: number | string;
  dir?: ExitArrowDir;
  label?: string;
}

export type ExitConfig = Record<string, ExitSign[]>;

interface ClusterDataFile {
  clusters: { id: string; name: string; svg?: string }[];
  transcripts?: TranscriptEntry[];
  definitions: Record<string, unknown>;
  exits?: ExitConfig;
  badgeBaseUrl?: string;
  badges?: Record<string, string>;
}

interface CampusManifest {
  campuses: { id: string; name: string; timezone?: string }[];
}

export let CLUSTERS: { id: string; name: string; svg?: string }[] = [];

import { WORKER_URL } from "../../core/worker.ts";
const CAMPUS_BASE = `${WORKER_URL}/gh/campuses`;
const CACHE_PREFIX = "CAMPUS_DATA_";
const MANIFEST_CACHE_KEY = "CAMPUS_MANIFEST_V2";
const CACHE_TTL = 60 * 60 * 1000;
const inFlightLoads = new Map<string, Promise<ClusterDataFile>>();

async function resolveCampusFolder(
  campusId: string,
  force?: boolean,
): Promise<string> {
  const manifest = await fetchCampusList(force);
  const campus = manifest.campuses.find((c) => c.id === campusId);
  if (!campus) return campusId;
  return campus.name.toLowerCase().replace(/\s+/g, "-");
}

async function resolveCampusId(
  campusId: string,
  force?: boolean,
): Promise<string> {
  if (campusId) return campusId;
  const manifest = await fetchCampusList(force);
  for (const campus of manifest.campuses) {
    const prefix = campus.name.toLowerCase().replace(/\s+/g, "-");
    const res = await fetch(`${CAMPUS_BASE}/${prefix}.json`, {
      cache: force ? "no-store" : undefined,
    });
    if (res.ok) return campus.id;
  }
  return "";
}

let campusListenerInstalled = false;
/** Last value we know CLUSTERS_CAMPUS holds, to avoid rewriting the same id. */
let knownCampusId: string | null = null;

function installCampusDetectedListener(): void {
  if (campusListenerInstalled) return;
  campusListenerInstalled = true;

  // Keeps the in-memory id exact when the campus is changed from the popup or
  // the settings page, so ensureCampusData() never has to re-read it.
  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area !== "local" || !("CLUSTERS_CAMPUS" in changes)) return;
    knownCampusId = String(changes.CLUSTERS_CAMPUS.newValue ?? "");
  });

  document.addEventListener("42_CAMPUS_DETECTED", async (e) => {
    if (location.pathname.includes("/users/")) return;
    const campusId = (e as CustomEvent).detail as string;
    // The page announces the campus on every load. Writing the same id again
    // wakes the background service worker and fans out to every
    // storage.onChanged listener in every frame, for nothing.
    if (knownCampusId === null) {
      knownCampusId = await getConfig("CLUSTERS_CAMPUS");
    }
    if (knownCampusId !== campusId) {
      knownCampusId = campusId;
      await chrome.storage.local.set({
        CLUSTERS_CAMPUS: campusId,
      });
    }
    if (CLUSTERS.length === 0) {
      try {
        const data = await loadCampusData(campusId);
        CLUSTERS = data.clusters;
      } catch {}
    }
  });
}

export async function fetchCampusList(
  force?: boolean,
): Promise<CampusManifest> {
  const cached = await chrome.storage.local.get(MANIFEST_CACHE_KEY);
  const cachedData = cached[MANIFEST_CACHE_KEY] as
    | { manifest: CampusManifest; timestamp: number }
    | undefined;
  if (!force && cachedData && Date.now() - cachedData.timestamp < CACHE_TTL) {
    return cachedData.manifest;
  }
  let manifest: CampusManifest;
  try {
    const res = await fetch(`${CAMPUS_BASE}/campuses.json`, {
      cache: force ? "no-store" : undefined,
    });
    if (!res.ok) throw new Error("Failed to fetch campus list");
    manifest = (await res.json()) as CampusManifest;
  } catch (e) {
    // Stale-if-error: an expired list beats none while the worker is down
    // (or over quota). A forced fetch is a request for fresh data (the hub's
    // reload button), so it still reports the failure.
    if (!force && cachedData) return cachedData.manifest;
    throw e;
  }
  await chrome.storage.local.set({
    [MANIFEST_CACHE_KEY]: { manifest, timestamp: Date.now() },
  });
  return manifest;
}

export async function loadCampusData(
  campusId: string,
  force?: boolean,
): Promise<ClusterDataFile> {
  const resolvedId = await resolveCampusId(campusId, force);
  if (!resolvedId) throw new Error("No campus data available");
  const cacheKey = `${CACHE_PREFIX}${resolvedId}`;
  // Also the stale-if-error fallback below. Not read for a forced load: that
  // one is a request for fresh data (the hub's reload), so it must fail loudly.
  let cachedData: { data: ClusterDataFile; timestamp: number } | undefined;
  if (!force) {
    const cached = await chrome.storage.local.get(cacheKey);
    cachedData = cached[cacheKey] as typeof cachedData;
    if (cachedData && Date.now() - cachedData.timestamp < CACHE_TTL) {
      return cachedData.data;
    }
  }
  const existing = force ? undefined : inFlightLoads.get(cacheKey);
  if (existing) return existing;
  const load = (async () => {
    let data: ClusterDataFile;
    try {
      const prefix = await resolveCampusFolder(resolvedId, force);
      const res = await fetch(`${CAMPUS_BASE}/${prefix}.json`, {
        cache: force ? "no-store" : undefined,
      });
      if (!res.ok)
        throw new Error(`Failed to fetch campus data for ${resolvedId}`);
      data = (await res.json()) as ClusterDataFile;
    } catch (e) {
      // Stale-if-error: the cluster list, transcripts, exits and badges of
      // an hour ago are better than none while the worker is unreachable.
      if (cachedData) return cachedData.data;
      throw e;
    }
    await chrome.storage.local.set({
      [cacheKey]: { data, timestamp: Date.now() },
    });
    return data;
  })().finally(() => {
    if (!force) inFlightLoads.delete(cacheKey);
  });
  if (!force) inFlightLoads.set(cacheKey, load);
  return force ? await load : load;
}

export async function clearCampusConfigCache(campusId: string): Promise<void> {
  await chrome.storage.local.remove([
    `${CACHE_PREFIX}${campusId}`,
    MANIFEST_CACHE_KEY,
  ]);
}

/** In-flight ensureCampusData(), shared by its three callers on a page load. */
let ensurePromise: Promise<void> | null = null;

/**
 * Load the campus cluster list once per page.
 *
 * WHY: main.ts, profile.ts and clusters.ts all call this during start-up. Each
 * call used to read CLUSTERS_CAMPUS from storage and, while the first load was
 * still in flight, start its own (CLUSTERS is only filled at the end), so the
 * cached campus file was read from storage three times before the profile page
 * was interactive.
 */
export async function ensureCampusData(): Promise<void> {
  installCampusDetectedListener();
  // Already loaded: the campus id would only be read to be thrown away.
  if (CLUSTERS.length > 0) return;
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    // Read once per page: the listeners above keep the value up to date.
    if (knownCampusId === null) {
      knownCampusId = await getConfig("CLUSTERS_CAMPUS");
    }
    const campus = knownCampusId;
    if (campus && campus !== "") {
      if (CLUSTERS.length === 0) {
        try {
          const data = await loadCampusData(campus);
          CLUSTERS = data.clusters;
        } catch {}
      }
    }
  })().finally(() => {
    // Cleared so that a failed load (offline, empty campus) can be retried by
    // the next caller, exactly as before.
    ensurePromise = null;
  });
  return ensurePromise;
}
