import { getConfig } from "../../core/config.ts";
import {
  decide,
  normalizeUrl,
  parseSubjectLink,
  formatShortDate,
  formatRelativeTime,
} from "./fingerprint.ts";
import { renderSubjectBadge } from "./ui.ts";
import { waitForElement } from "../../core/dom/dom-wait.ts";

import { workerFetch } from "../../core/worker.ts";
const CHECK_COOLDOWN_MS = 15 * 60 * 1000;

interface LocalSubjectState {
  lastUrl?: string;
  versionDate?: number;
  changedAt?: number;
  checkedAt?: number;
}

type SubjectTrackerState = Record<string, LocalSubjectState>;

interface WorkerStateEntry {
  slug: string;
  tracked: boolean;
  name?: string;
  subjectId?: string | null;
  createdAt?: number | null;
  modifiedAt?: number | null;
  lastChangedAt?: number | null;
}

interface WorkerReportEntry {
  slug: string;
  status: "first" | "known" | "changed" | "unknown";
  name?: string;
  createdAt?: number | null;
  modifiedAt?: number | null;
  lastChangedAt?: number | null;
  subjectId?: string | null;
}

/** The session workerFetch() signs a request with (it hashes the login). */
interface CloudClient {
  token: string;
  login: string;
}

export function matchProjectSlug(pathname: string): string | null {
  const m = pathname.match(/^\/(?:projects\/)?([^/]+)(?:\/.*)?$/);
  return m ? m[1] : null;
}

function isProjectPage(): string | null {
  if (window.location.hostname !== "projects.intra.42.fr") return null;
  return matchProjectSlug(window.location.pathname);
}

const SUBJECT_ANCHOR_SELECTOR = '.project-attachments-list a[href$=".pdf"]';
/** Same deadline as the old 40 x 150 ms poll. */
const SUBJECT_WAIT_MS = 6000;

/**
 * The state key holds one entry per project slug ever opened with a PDF and
 * is a snapshot key: every write copies and broadcasts the whole record. Kept
 * to the most recently checked slugs so it cannot grow for the life of the
 * install. Bounded by the curriculum in practice; the cap is a safety net.
 */
const MAX_TRACKED_SLUGS = 500;

function pruneState(state: SubjectTrackerState): SubjectTrackerState {
  const slugs = Object.keys(state);
  if (slugs.length <= MAX_TRACKED_SLUGS) return state;
  slugs.sort((a, b) => (state[b].checkedAt ?? 0) - (state[a].checkedAt ?? 0));
  const kept: SubjectTrackerState = {};
  for (const slug of slugs.slice(0, MAX_TRACKED_SLUGS)) kept[slug] = state[slug];
  return kept;
}

async function readLocalState(): Promise<SubjectTrackerState> {
  const raw = await getConfig("SUBJECT_TRACKER_STATE");
  return (raw && typeof raw === "object" ? raw : {}) as SubjectTrackerState;
}

async function cloudClient(): Promise<CloudClient | null> {
  const [token, login] = await Promise.all([
    getConfig("CLOUD_TOKEN"),
    getConfig("CLOUD_LOGIN"),
  ]);
  if (!token || !login) return null;
  return { token, login };
}

async function getWorkerState(
  slug: string,
  client: CloudClient,
): Promise<WorkerStateEntry | null> {
  // workerFetch: a 401 flags CLOUD_AUTH_FAILED (the hub's "Reconnect")
  // instead of failing without a word, and a hung worker times out.
  const res = await workerFetch(
    `/api/v1/private/subjects/state?slugs=${encodeURIComponent(slug)}`,
    { auth: client },
  );
  if (!res.ok) return null;
  const data = res.json as { subjects?: WorkerStateEntry[] } | null;
  return data?.subjects?.find((s) => s.slug === slug) ?? null;
}

async function reportToWorker(
  slug: string,
  client: CloudClient,
  url: string,
): Promise<WorkerReportEntry | null> {
  const res = await workerFetch("/api/v1/private/subjects/report", {
    method: "POST",
    body: { items: [{ slug, url: normalizeUrl(url) }] },
    auth: client,
  });
  if (!res.ok) return null;
  const data = res.json as { subjects?: WorkerReportEntry[] } | null;
  return data?.subjects?.find((s) => s.slug === slug) ?? null;
}

function versionDateOf(
  createdAt: number | null | undefined,
  modifiedAt: number | null | undefined,
  fallback?: number,
): number | undefined {
  return modifiedAt ?? createdAt ?? fallback ?? undefined;
}

export async function initSubjectTracker(): Promise<void> {
  const enabled = await getConfig("SUBJECT_TRACKER_ENABLED");
  if (!enabled) return;

  const slug = isProjectPage();
  if (!slug) return;

  // One observer with a deadline: the Rails page is rendered by the time this
  // runs, so on the many projects pages without a subject PDF the old 150 ms
  // poll woke 40 times for nothing.
  const anchor = await waitForElement<HTMLAnchorElement>(
    SUBJECT_ANCHOR_SELECTOR,
    { timeoutMs: SUBJECT_WAIT_MS },
  );
  if (!anchor) return;

  const url = anchor.href;
  const state = await readLocalState();
  const local = state[slug] ?? {};
  if (local.checkedAt && Date.now() - local.checkedAt < CHECK_COOLDOWN_MS) {
    maybeRenderBadge(slug, local, anchor);
    return;
  }

  const client = await cloudClient();
  const sendData = await getConfig("SUBJECT_TRACKER_SEND_DATA");
  let nextLocal: LocalSubjectState;

  if (client && sendData) {
    const entry = await getWorkerState(slug, client);
    if (entry === null) {
      // Worker unreachable → fall back to latest local knowledge.
      nextLocal = {
        lastUrl: local.lastUrl ?? normalizeUrl(url),
        versionDate: local.versionDate,
        changedAt: local.changedAt,
        checkedAt: Date.now(),
      };
    } else if (!entry.tracked) {
      // Never-seen slug → seed via the worker (reads the PDF metadata). No
      // date when the report fails or the PDF carries none: a Date.now() seed
      // read as a "Subject updated / just now" alert on a subject nothing
      // happened to.
      const report = await reportToWorker(slug, client, url);
      nextLocal = {
        lastUrl: normalizeUrl(url),
        versionDate: versionDateOf(
          report?.createdAt,
          report?.modifiedAt,
          local.versionDate,
        ),
        changedAt: local.changedAt,
        checkedAt: Date.now(),
      };
    } else {
      const currentSubjectId = parseSubjectLink(url)?.subjectId ?? null;
      const recordedSubjectId = entry.subjectId ?? null;
      if (
        currentSubjectId &&
        recordedSubjectId &&
        currentSubjectId !== recordedSubjectId
      ) {
        // Resource differs from the registry → report the change.
        const report = await reportToWorker(slug, client, url);
        const changed =
          report?.status === "changed"
            ? report
            : {
                modifiedAt: entry.modifiedAt,
                lastChangedAt: entry.lastChangedAt,
              };
        nextLocal = {
          lastUrl: normalizeUrl(url),
          versionDate:
            versionDateOf(changed.modifiedAt, undefined) ??
            versionDateOf(entry.createdAt, entry.modifiedAt),
          changedAt: changed.lastChangedAt ?? Date.now(),
          checkedAt: Date.now(),
        };
      } else {
        // Same link → show the recorded state (baseline or previous update).
        nextLocal = {
          lastUrl: normalizeUrl(url),
          versionDate: versionDateOf(entry.createdAt, entry.modifiedAt),
          changedAt: entry.lastChangedAt ?? undefined,
          checkedAt: Date.now(),
        };
      }
    }
  } else {
    // No cloud session → pure local comparison of the link.
    const prev = local.lastUrl ? { url: local.lastUrl } : null;
    if (decide(prev, { url }) === "changed") {
      nextLocal = {
        lastUrl: normalizeUrl(url),
        changedAt: Date.now(),
        checkedAt: Date.now(),
      };
    } else {
      // No prior record and no known change → keep no date so no badge shows.
      nextLocal = {
        lastUrl: normalizeUrl(url),
        versionDate: local.versionDate,
        changedAt: local.changedAt,
        checkedAt: Date.now(),
      };
    }
  }

  await chrome.storage.local.set({
    SUBJECT_TRACKER_STATE: pruneState({ ...state, [slug]: nextLocal }),
  });

  maybeRenderBadge(slug, nextLocal, anchor);
}

export function maybeRenderBadge(
  _slug: string,
  local: LocalSubjectState,
  button: HTMLAnchorElement | null,
): void {
  if (!button) return;
  const date = local.versionDate ?? local.changedAt;
  if (!date) return;

  const DAY = 86_400_000;
  const age = Date.now() - date;
  const recent = age <= 7 * DAY;
  const tone: "error" | "warning" | "ghost" =
    age <= 7 * DAY ? "error" : age <= 30 * DAY ? "warning" : "ghost";
  const when = recent ? formatRelativeTime(date) : formatShortDate(date);
  renderSubjectBadge(button, "Subject updated", when, tone);
}
