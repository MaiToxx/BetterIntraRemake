import { html, render } from "lit-html";
import { unsafeHTML } from "lit-html/directives/unsafe-html.js";
import { getConfig } from "../../../core/config.ts";
import { getCloudLogin } from "../../account/account.ts";
import { getLoginFromPage } from "../../../core/intra/profile-login.ts";
import { waitForIntrapyToken } from "../../../core/intra/intrapy.ts";
import { INTRA_FONT } from "../../logtime/constants.ts";
import CHECK_SVG from "../../../assets/svg/check.svg?raw";
import X_SVG from "../../../assets/svg/x.svg?raw";
import CHEVRON_DOWN_SVG from "../../../assets/svg/chevron-down.svg?raw";
import { createSkeleton } from "../../../core/dom/skeleton.ts";

const DATE_COLUMN_WIDTH = "150px";
const SCORE_COLUMN_WIDTH = "24px";

interface MarkedProject {
  projects_user_id: number;
  project_name: string;
  project_slug: string;
  final_mark: number;
  last_event_date: string;
  is_validated: boolean;
  occurrence: number;
  teams: {
    last_event_date: string;
    final_mark: number;
    is_validated: boolean;
    occurrence: number;
  }[];
}

const INJECTED_ID = "ft-marks-injected";
const SKELETON_ID = "ft-marks-skeleton";

const dateObservers = new WeakMap<HTMLElement, MutationObserver>();
const sidebarObservers: MutationObserver[] = [];

let marksCache: Record<string, MarkedProject[]> = {};
let marksInitialized = false;
let ownProfileLoading = false;
let otherProfileRunning = false;
let cachedLogin: string | null = null;

/** How long to wait for the page to hand over a usable Intra token. */
const TOKEN_WAIT_MS = 15000;

/**
 * The API returns "YYYY-MM-DDTHH:MM:SS" without a timezone, meaning UTC.
 * Append "Z" only when no offset is present so both the row and its tooltip
 * agree (parsing it bare used to treat it as local time, off by one day
 * around midnight; appending "Z" blindly broke strings that had an offset).
 */
function parseApiDate(dateStr: string): Date {
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(dateStr)
    ? new Date(dateStr)
    : new Date(dateStr + "Z");
}

function formatDate(dateStr: string): string {
  const d = parseApiDate(dateStr);
  const now = new Date();
  const todayMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const eventMidnight = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
  ).getTime();
  const days = Math.floor((todayMidnight - eventMidnight) / 86400000);
  const relative =
    days < 1 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
  const real = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${relative} (${real})`;
}

function formatTooltipDate(dateStr: string): string {
  const d = parseApiDate(dateStr);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear() % 100).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yy} ${hh}:${min}`;
}

function waitForCursusId(timeout = 10000): Promise<string> {
  return new Promise((resolve) => {
    const stored = sessionStorage.getItem("ft_active_cursus_id");
    if (stored) {
      resolve(stored);
      return;
    }

    let resolved = false;
    let timer: ReturnType<typeof setTimeout>;

    const handler = (e: CustomEvent) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(e.detail);
    };
    const cleanup = () => {
      document.removeEventListener("42_CURSUS_ID", handler as EventListener);
      clearTimeout(timer);
    };
    document.addEventListener("42_CURSUS_ID", handler as EventListener);

    timer = setTimeout(() => {
      cleanup();
      resolve("21");
    }, timeout);
  });
}

/**
 * The marked projects of `login` in `cursusId`, or null when the request
 * failed (expired token, network error...). null is never cached, so the next
 * cursus switch asks again instead of showing "no projects" for the rest of
 * the page.
 */
async function fetchMarks(
  login: string,
  token: string,
  cursusId: string,
): Promise<MarkedProject[] | null> {
  const url = `https://intrapy.intra.42.fr/api/v1/users/${login}/projects/marked?cursus_id=${cursusId}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: token },
    });
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as MarkedProject[];
    if (!Array.isArray(data)) return null;
    return data.filter((p) => p.final_mark !== null);
  } catch (err) {
    return null;
  }
}

/** The cached marks for `key`, fetched (and cached) on a miss; null if that failed. */
async function getMarks(
  key: string,
  login: string,
  token: string,
  cursusId: string,
): Promise<MarkedProject[] | null> {
  const cached = marksCache[key];
  if (cached) return cached;
  const fetched = await fetchMarks(login, token, cursusId);
  if (fetched) marksCache[key] = fetched;
  return fetched;
}

function findCard(title: "PROJECTS" | "MARKS"): HTMLElement | null {
  const cards = document.querySelectorAll<HTMLElement>(".bg-white.md\\:h-96");
  for (const card of cards) {
    const titleEl = card.querySelector("[class*='uppercase']");
    const text = titleEl?.textContent?.trim();
    if (text?.toUpperCase().startsWith(title)) {
      return card;
    }
  }
  return null;
}

export function renderStatusIcon(
  container: HTMLElement,
  isValidated: boolean,
): void {
  container.className = isValidated ? "text-green-500" : "text-red-500";
  render(
    html`<span class="size-6 flex items-center justify-center"
      >${unsafeHTML(isValidated ? CHECK_SVG : X_SVG)}</span
    >`,
    container,
  );
  const svg = container.querySelector("svg");
  if (svg) {
    svg.setAttribute("width", "24");
    svg.setAttribute("height", "24");
    svg.style.display = "block";
    svg.style.fill = isValidated ? "#22c55e" : "#ef4444";
  }
}

export function createChevronElement(): SVGElement {
  const span = document.createElement("span");
  // Project rule: no innerHTML, render through lit-html instead
  render(unsafeHTML(CHEVRON_DOWN_SVG), span);
  const chevron = span.querySelector("svg")! as SVGElement;
  chevron.setAttribute("width", "18");
  chevron.setAttribute("height", "18");
  chevron.classList.add("lucide", "lucide-chevron-down");
  chevron.style.transition = "transform 0.2s";
  return chevron;
}

export function createProjectLink(project: MarkedProject): HTMLAnchorElement {
  const link = document.createElement("a");
  link.href = `https://projects.intra.42.fr/projects/${project.project_slug}/projects_users/${project.projects_user_id}`;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.className = "text-legacy-main hover:underline text-xs";
  link.textContent =
    project.teams.length > 1
      ? `${project.project_name} #${project.occurrence}`
      : project.project_name;
  return link;
}

export function createTeamRow(
  project: MarkedProject,
  team: MarkedProject["teams"][0],
): HTMLElement {
  const row = document.createElement("div");
  row.className =
    "flex flex-row justify-between text-gray-400 hover:text-black hover:bg-gray-300 py-1 px-2";

  const left = document.createElement("div");
  left.className = "flex flex-row gap-1 items-center flex-1";
  const label = document.createElement("span");
  label.className = "text-xs";
  label.textContent = `${project.project_name} #${team.occurrence}`;
  left.appendChild(label);
  const date = document.createElement("span");
  date.className = "text-xs opacity-60";
  date.style.cssText =
    "margin-left: auto; min-width: 170px; text-align: right; flex-shrink: 0; margin-right: 12px;";
  date.textContent = formatDate(team.last_event_date);
  left.appendChild(date);
  row.appendChild(left);

  const right = document.createElement("p");
  right.className = "text-xs flex flex-row items-center gap-1";
  right.style.minWidth = "52px";
  const icon = document.createElement("div");
  renderStatusIcon(icon, team.is_validated);
  right.appendChild(icon);
  const teamScore = document.createElement("span");
  teamScore.style.display = "inline-block";
  teamScore.style.minWidth = SCORE_COLUMN_WIDTH;
  teamScore.style.textAlign = "right";
  teamScore.textContent = String(team.final_mark);
  right.appendChild(teamScore);
  row.appendChild(right);

  return row;
}

async function waitForCard(
  title: "PROJECTS" | "MARKS",
): Promise<HTMLElement | null> {
  for (let i = 0; i < 100; i++) {
    const card = findCard(title);
    if (card) {
      if (i >= 30) return card;
      const ul = card.querySelector(".h-full ul");
      const lis = ul?.querySelectorAll("li");
      if (lis && lis.length > 0) return card;
    }
    await new Promise((r) => requestAnimationFrame(r));
  }
  return null;
}

function removeMarksSkeleton() {
  document.getElementById(SKELETON_ID)?.remove();
}

/**
 * Holds the space of the finished-projects list inside the PROJECTS card while
 * the intra API request is in flight, so the rows do not pop in afterwards.
 */
function showMarksSkeleton(card: HTMLElement) {
  if (document.getElementById(SKELETON_ID)) return;
  if (document.getElementById(INJECTED_ID)) return;

  const inner = card.querySelector<HTMLElement>(".flex.flex-col.w-full.h-full");
  if (!inner) return;

  const hFull = inner.querySelector<HTMLElement>(".h-full");
  const hasBadges = hFull?.querySelector("ul")?.style.display === "none";

  const container = document.createElement("div");
  container.id = SKELETON_ID;
  container.style.cssText = `${hasBadges ? "border-top: 1px solid hsl(var(--primary) / 0.2); " : ""}padding: 0.5rem 8px 0.5rem 0; font-family: ${INTRA_FONT};`;

  const widths = ["58%", "44%", "66%", "38%", "52%", "48%"];
  for (const width of widths) {
    const row = document.createElement("div");
    row.className = "flex flex-row justify-between items-center py-1 px-2";
    row.appendChild(createSkeleton({ width, height: "12px" }));

    const right = document.createElement("div");
    right.className = "flex flex-row items-center gap-2";
    right.appendChild(
      createSkeleton({ width: DATE_COLUMN_WIDTH, height: "12px" }),
    );
    right.appendChild(
      createSkeleton({ width: SCORE_COLUMN_WIDTH, height: "12px" }),
    );
    row.appendChild(right);

    container.appendChild(row);
  }

  if (hFull) {
    inner.insertBefore(container, hFull.nextSibling);
  } else {
    inner.appendChild(container);
  }
}

function injectFinishedProjects(card: HTMLElement, marks: MarkedProject[]) {
  removeMarksSkeleton();
  document.getElementById(INJECTED_ID)?.remove();

  if (marks.length === 0) return;

  const inner = card.querySelector<HTMLElement>(".flex.flex-col.w-full.h-full");
  if (!inner) return;

  const hFull = inner.querySelector<HTMLElement>(".h-full");
  const hasBadges = hFull?.querySelector("ul")?.style.display === "none";

  const sorted = [...marks].sort(
    (a, b) =>
      new Date(b.last_event_date).getTime() -
      new Date(a.last_event_date).getTime(),
  );

  const container = document.createElement("div");
  container.id = INJECTED_ID;
  container.style.cssText = `${hasBadges ? "border-top: 1px solid hsl(var(--primary) / 0.2); " : ""}padding: 0.5rem 8px 0.5rem 0; font-family: ${INTRA_FONT};`;

  const list = document.createElement("div");
  list.className = "flex flex-col";

  for (const project of sorted) {
    if (project.teams && project.teams.length > 1) {
      const wrapper = document.createElement("div");
      wrapper.className = "w-full";

      const uid = `ft-teams-${project.projects_user_id}`;
      let expanded = false;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "w-full text-xs";
      btn.style.fontWeight = "400";

      const row = document.createElement("div");
      row.className =
        "flex flex-row justify-between hover:bg-gray-300 py-1 px-2";

      const left = document.createElement("div");
      left.className = "flex flex-row gap-1 items-center flex-1";
      left.appendChild(createProjectLink(project));
      left.appendChild(createChevronElement());
      row.appendChild(left);

      const right = document.createElement("div");
      right.className = "text-xs flex flex-row items-center gap-2";
      right.style.minWidth = "52px";
      const time = document.createElement("span");
      time.className = "opacity-50";
      time.style.display = "inline-block";
      time.style.minWidth = DATE_COLUMN_WIDTH;
      time.style.textAlign = "right";
      time.textContent = formatDate(project.last_event_date);
      right.appendChild(time);
      const iconWrap = document.createElement("div");
      renderStatusIcon(iconWrap, project.is_validated);
      right.appendChild(iconWrap);
      const score = document.createElement("span");
      score.style.display = "inline-block";
      score.style.minWidth = SCORE_COLUMN_WIDTH;
      score.style.textAlign = "right";
      score.textContent = String(project.final_mark);
      right.appendChild(score);
      row.appendChild(right);
      btn.appendChild(row);
      wrapper.appendChild(btn);

      const panel = document.createElement("div");
      panel.id = uid;
      panel.style.display = "none";
      panel.style.padding = "0 0 0 12px";
      panel.style.borderTop = "1px solid hsl(var(--primary) / 0.2)";

      const sortedTeams = [...project.teams].sort(
        (a, b) => b.occurrence - a.occurrence,
      );
      for (const team of sortedTeams) {
        panel.appendChild(createTeamRow(project, team));
      }

      wrapper.appendChild(panel);

      const chevron = left.querySelector(".lucide-chevron-down") as HTMLElement;
      btn.onclick = (e) => {
        if (
          e.target instanceof HTMLAnchorElement ||
          (e.target as HTMLElement).closest("a")
        )
          return;
        e.preventDefault();
        expanded = !expanded;
        panel.style.display = expanded ? "block" : "none";
        if (chevron) chevron.style.transform = expanded ? "rotate(180deg)" : "";
      };

      list.appendChild(wrapper);
    } else {
      const item = document.createElement("div");
      item.className =
        "flex flex-row justify-between hover:bg-gray-300 py-1 px-2";

      const left = document.createElement("div");
      left.className = "flex flex-row gap-1 items-center flex-1";
      left.appendChild(createProjectLink(project));
      item.appendChild(left);

      const right = document.createElement("div");
      right.className = "text-xs flex flex-row items-center gap-2";
      right.style.minWidth = "52px";
      const time = document.createElement("span");
      time.className = "opacity-50";
      time.style.display = "inline-block";
      time.style.minWidth = DATE_COLUMN_WIDTH;
      time.style.textAlign = "right";
      time.textContent = formatDate(project.last_event_date);
      right.appendChild(time);
      const iconWrap = document.createElement("div");
      renderStatusIcon(iconWrap, project.is_validated);
      right.appendChild(iconWrap);
      const score = document.createElement("span");
      score.style.display = "inline-block";
      score.style.minWidth = SCORE_COLUMN_WIDTH;
      score.style.textAlign = "right";
      score.textContent = String(project.final_mark);
      right.appendChild(score);
      item.appendChild(right);
      list.appendChild(item);
    }
  }

  container.appendChild(list);

  if (hFull) {
    inner.insertBefore(container, hFull.nextSibling);
  } else {
    inner.appendChild(container);
  }
}

async function handleCursusSwitch(cursusId: string) {
  if (ownProfileLoading) return;
  const login = cachedLogin;
  if (!login) return;

  const cardPromise = waitForCard("PROJECTS");
  let marks: MarkedProject[] | null = marksCache[cursusId] ?? null;
  if (!marks) {
    void cardPromise.then((card) => card && showMarksSkeleton(card));
    // The token of the page load is short-lived: by the time the student
    // switches cursus it has often expired, so take the current one.
    const token = await waitForIntrapyToken(TOKEN_WAIT_MS);
    marks = token ? await getMarks(cursusId, login, token, cursusId) : null;
  }
  const card = await cardPromise;
  if (card) {
    injectFinishedProjects(card, marks ?? []);
  } else {
    removeMarksSkeleton();
  }
}

function collectEntries(
  card: HTMLElement,
): { el: HTMLElement; projectsUserId: number }[] {
  const container = card.querySelector<HTMLElement>(".flex.flex-col.gap-2");
  if (!container) return [];
  const items = container.querySelectorAll<HTMLElement>(":scope > div");
  const entries: { el: HTMLElement; projectsUserId: number }[] = [];
  for (let i = 0; i < items.length; i++) {
    const link = items[i].querySelector<HTMLAnchorElement>(
      "a[href*='projects_users']",
    );
    if (!link) continue;
    const match = link.href.match(/projects_users\/(\d+)/);
    if (!match) continue;
    entries.push({ el: items[i], projectsUserId: Number(match[1]) });
  }
  return entries;
}

async function enhanceExistingMarks(
  card: HTMLElement,
  marks?: MarkedProject[],
): Promise<boolean> {
  let attempts = 0;
  while (attempts < 30) {
    const container = card.querySelector<HTMLElement>(".flex.flex-col.gap-2");
    if (container) {
      const items = container.querySelectorAll<HTMLElement>(":scope > div");
      if (items.length > 0) {
        const entries = collectEntries(card);

        if (marks) {
          const marksById = new Map<number, string>();
          for (const m of marks) {
            marksById.set(m.projects_user_id, m.last_event_date);
          }
          let annotated = 0;
          for (const entry of entries) {
            const project = marks?.find(
              (m) => m.projects_user_id === entry.projectsUserId,
            );
            const ts = marksById.get(entry.projectsUserId);
            if (ts) {
              entry.el.setAttribute("data-last-event-date", ts);
              entry.el.setAttribute("data-tip", formatTooltipDate(ts));
              annotated++;
            }
            if (project && project.teams && project.teams.length > 1) {
              const teamDates: Record<string, string> = {};
              for (const team of project.teams) {
                teamDates[team.occurrence] = team.last_event_date;
              }
              entry.el.setAttribute(
                "data-team-dates",
                JSON.stringify(teamDates),
              );
            }
          }

          const showRealDate = await getConfig("PROFILE_MARKS_SHOW_REAL_DATE");
          if (showRealDate) {
            const RELATIVE_RE =
              /^\s*(about|over|almost|nearly)?\s*(\d+|a|an)\s+(second|minute|hour|day|month|year)s?\s+ago\s*$/i;

            const replaceDatesInContainer = (container: HTMLElement) => {
              const walker = document.createTreeWalker(
                container,
                NodeFilter.SHOW_TEXT,
              );
              const toReplace: { node: Text; ts: string }[] = [];
              let node: Text | null;
              while ((node = walker.nextNode() as Text | null)) {
                const text = node.textContent ?? "";
                if (!RELATIVE_RE.test(text)) continue;
                const wrapper = node.parentElement?.closest<HTMLElement>(
                  "[data-last-event-date]",
                );
                if (!wrapper) continue;
                let ts = wrapper.getAttribute("data-last-event-date");
                if (!ts) continue;
                const teamDatesStr = wrapper.getAttribute("data-team-dates");
                if (teamDatesStr) {
                  let searchEl: HTMLElement | null = node.parentElement;
                  while (searchEl && searchEl !== wrapper) {
                    const occMatch = (searchEl.textContent ?? "").match(
                      /#(\d+)/,
                    );
                    if (occMatch) {
                      const teamDates = JSON.parse(teamDatesStr) as Record<
                        string,
                        string
                      >;
                      const teamTs = teamDates[occMatch[1]];
                      if (teamTs) ts = teamTs;
                      break;
                    }
                    searchEl = searchEl.parentElement;
                  }
                }
                toReplace.push({ node, ts });
              }
              for (const { node, ts } of toReplace) {
                node.textContent = formatTooltipDate(ts);
              }
              return toReplace.length;
            };
            replaceDatesInContainer(card);

            const existing = dateObservers.get(card);
            if (existing) existing.disconnect();

            const dateObserver = new MutationObserver((mutations) => {
              for (const m of mutations) {
                if (m.type === "childList") {
                  for (const node of m.addedNodes) {
                    if (node instanceof HTMLElement) {
                      replaceDatesInContainer(node);
                    }
                  }
                } else if (m.type === "attributes") {
                  if (m.target instanceof HTMLElement) {
                    replaceDatesInContainer(m.target);
                  }
                }
              }
            });
            dateObserver.observe(card, {
              childList: true,
              subtree: true,
              attributes: true,
              attributeFilter: ["data-state", "hidden"],
            });
            dateObservers.set(card, dateObserver);
          }
        }

        for (const entry of entries) {
          const row = entry.el.querySelector<HTMLElement>(
            ".flex.flex-row.justify-between.hover\\:bg-gray-300",
          );
          if (row) {
            row.style.paddingTop = "0.25rem";
            row.style.paddingBottom = "0.25rem";
            row.style.paddingLeft = "0.5rem";
            row.style.paddingRight = "0.5rem";
          }

          const btn = entry.el.querySelector("button");
          if (btn) {
            btn.style.fontWeight = "400";
            btn.style.fontSize = "inherit";
            btn.style.fontFamily = "inherit";
            btn.style.color = "inherit";
          }

          const leftSide = entry.el.querySelector<HTMLElement>(
            ".flex.flex-row.gap-1",
          );
          if (!leftSide) continue;
          const link = leftSide.querySelector("a");
          if (!link) continue;
          link.style.fontSize = "0.875rem";

          const rightSide = entry.el.querySelector<HTMLElement>(
            ".text-xs.flex.flex-row.items-center",
          );

          let dateNode: Node | null = null;
          for (const child of [...leftSide.childNodes]) {
            if (child === link) continue;
            if (child instanceof SVGElement) continue;
            if (
              child.nodeType === Node.TEXT_NODE &&
              child.textContent?.trim()
            ) {
              dateNode = child;
              break;
            }
            if (
              child instanceof HTMLElement &&
              !child.textContent?.includes("⭐")
            ) {
              dateNode = child;
              break;
            }
          }

          if (dateNode && rightSide) {
            const dateSpan = document.createElement("span");
            dateSpan.className = "opacity-50 text-sm";
            dateSpan.style.whiteSpace = "nowrap";
            dateSpan.style.display = "inline-block";
            dateSpan.style.minWidth = DATE_COLUMN_WIDTH;
            dateSpan.style.textAlign = "right";
            dateSpan.textContent = dateNode.textContent?.trim() ?? "";
            (dateNode as ChildNode).replaceWith(dateSpan);
            rightSide.prepend(dateSpan);
            if (!rightSide.style.gap) rightSide.style.gap = "0.25rem";
          }

          if (rightSide) {
            let scoreNode: Node | null = null;
            for (const child of [...rightSide.childNodes]) {
              if (child instanceof SVGElement) continue;
              if (
                child instanceof HTMLElement &&
                (child.classList.contains("text-green-500") ||
                  child.classList.contains("text-red-500"))
              )
                continue;
              if (
                child.nodeType === Node.TEXT_NODE &&
                child.textContent?.trim()
              ) {
                scoreNode = child;
              } else if (
                child instanceof HTMLElement &&
                child.textContent?.trim() &&
                !child.querySelector("svg")
              ) {
                scoreNode = child;
              }
            }
            if (scoreNode) {
              const scoreSpan = document.createElement("span");
              scoreSpan.style.display = "inline-block";
              scoreSpan.style.minWidth = SCORE_COLUMN_WIDTH;
              scoreSpan.style.textAlign = "right";
              scoreSpan.textContent = scoreNode.textContent?.trim() ?? "";
              (scoreNode as ChildNode).replaceWith(scoreSpan);
            }
          }

          let prevSibling: Node = link;
          for (const child of [...leftSide.childNodes]) {
            if (
              child instanceof HTMLSpanElement &&
              child.textContent?.includes("⭐")
            ) {
              if (child.previousSibling !== prevSibling) {
                (prevSibling as ChildNode).after(child);
              }
              prevSibling = child;
            }
          }
        }

        const sortedEntries = [...container.children] as HTMLElement[];
        sortedEntries.sort((a, b) => {
          const da = a.getAttribute("data-last-event-date") || "";
          const db = b.getAttribute("data-last-event-date") || "";
          return db.localeCompare(da);
        });
        for (const entry of sortedEntries) container.appendChild(entry);

        card.dataset.ftEntries = String(entries.length);
        card.dataset.ftEnhanced = "true";
        return true;
      }
    }
    await new Promise((r) => requestAnimationFrame(r));
    attempts++;
  }
  return false;
}

export async function initMarks() {
  if (marksInitialized) return;

  const showMarks = await getConfig("PROFILE_SHOW_MARKS");
  if (!showMarks) return;

  if (location.hostname !== "profile-v3.intra.42.fr") return;

  const isOwnProfile = location.pathname === "/";
  if (isOwnProfile) {
    if (ownProfileLoading) return;
    ownProfileLoading = true;

    const pageLogin = getLoginFromPage();
    const profileLogin = (await getCloudLogin()) || pageLogin;
    if (!profileLogin) {
      ownProfileLoading = false;
      return;
    }

    // The card is claimed before the requests start: as soon as intra has
    // rendered it, the placeholder rows take the space the marks will occupy.
    const cardPromise = waitForCard("PROJECTS");
    void cardPromise.then((card) => card && showMarksSkeleton(card));

    const token = await waitForIntrapyToken(TOKEN_WAIT_MS);
    if (!token) {
      removeMarksSkeleton();
      ownProfileLoading = false;
      return;
    }

    cachedLogin = profileLogin;

    document.addEventListener("42_CURSUS_ID", ((e: CustomEvent) => {
      const cursusId =
        e.detail || sessionStorage.getItem("ft_active_cursus_id") || "21";
      handleCursusSwitch(cursusId);
    }) as EventListener);

    const cursusId = await waitForCursusId(10000);
    const marks = await getMarks(cursusId, profileLogin, token, cursusId);

    const card = await cardPromise;
    if (card) {
      injectFinishedProjects(card, marks ?? []);
    } else {
      removeMarksSkeleton();
    }

    marksInitialized = true;
    ownProfileLoading = false;
  } else {
    const targetLogin = location.pathname.split("/")[2];
    if (!targetLogin) return;

    if (otherProfileRunning) return;

    const card = await waitForCard("MARKS");
    if (!card) return;

    otherProfileRunning = true;
    let marksData: MarkedProject[] | undefined;
    const token = await waitForIntrapyToken(TOKEN_WAIT_MS);
    const cursusId = token ? await waitForCursusId(10000) : null;
    if (token && cursusId) {
      const key = `OTHER_${targetLogin}_${cursusId}`;
      marksData =
        (await getMarks(key, targetLogin, token, cursusId)) ?? undefined;
    }
    const enhanced = await enhanceExistingMarks(card, marksData);
    otherProfileRunning = false;
    if (!enhanced) {
      marksInitialized = true;
      return;
    }

    marksInitialized = true;

    const sidebar = card.closest(".w-full")
      ?.previousElementSibling as HTMLElement | null;
    const wrapper = sidebar?.nextElementSibling as HTMLElement | null;
    if (wrapper) {
      let enhancing = false;
      const observer = new MutationObserver(() => {
        if (enhancing) return;
        const marksCard = findCard("MARKS");
        if (!marksCard || !wrapper.contains(marksCard)) return;
        const lastCount = Number(marksCard.dataset.ftEntries || 0);
        const currentCount = collectEntries(marksCard).length;
        if (currentCount <= lastCount) return;
        enhancing = true;
        void enhanceExistingMarks(marksCard, marksData).finally(
          () => {
            enhancing = false;
          },
        );
      });
      observer.observe(wrapper, { childList: true, subtree: true });
      sidebarObservers.push(observer);

      window.addEventListener(
        "pagehide",
        () => {
          for (const obs of sidebarObservers) obs.disconnect();
          sidebarObservers.length = 0;
        },
        { once: true },
      );
    }
  }
}
