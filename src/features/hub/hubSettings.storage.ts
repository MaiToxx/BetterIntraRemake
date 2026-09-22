import { getConfig } from "../../core/config.ts";
import {
  FEATURE_IDS,
  STORAGE_KEY,
  TOGGLEABLE_FEATURE_IDS,
  FeatureId,
} from "./hubSettings.data.ts";

function normalizeActive(raw: unknown): FeatureId[] {
  let parsed: unknown = raw;

  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null; // unparsable: treated as garbage below, not as "nothing enabled"
    }
  }

  // Garbage falls back to the features that have a switch, like the default:
  // an always-on tab has no initializer, so listing it changed nothing.
  if (!Array.isArray(parsed)) {
    return [...TOGGLEABLE_FEATURE_IDS];
  }

  // An empty list is a valid choice (the user disabled every feature).
  // Previously it silently re-enabled everything on the next page load.
  if (parsed.length === 0) return [];

  const ids = (parsed as string[]).filter((v): v is FeatureId =>
    FEATURE_IDS.has(v as FeatureId),
  );

  // Only unknown ids: the stored value is garbage, fall back to the defaults.
  if (ids.length === 0) return [...TOGGLEABLE_FEATURE_IDS];

  return ids;
}

export async function getActiveFeatures(): Promise<FeatureId[]> {
  const raw = await getConfig(STORAGE_KEY);
  const active = normalizeActive(raw);

  // Only write back when normalisation changed something: this runs on every
  // page load and each write wakes every storage.onChanged listener.
  if (JSON.stringify(raw) !== JSON.stringify(active)) {
    await chrome.storage.local.set({ [STORAGE_KEY]: active });
  }

  return active;
}
