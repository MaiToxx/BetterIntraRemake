import { getConfig } from "../../../core/config.ts";
import { DASHBOARD_CARD_SELECTOR } from "../../../core/intra/selectors.ts";
import { t } from "../../../core/i18n/i18n.ts";

const CARD_TITLE = "PENDING EVALUATIONS";

function findNativeCard(): HTMLElement | null {
  const grid =
    document.querySelector(".dash-main") ||
    document.querySelector(DASHBOARD_CARD_SELECTOR)?.parentElement ||
    document.body;
  const cards = grid.querySelectorAll(".bg-white");
  for (const card of cards) {
    if (card.textContent?.toUpperCase().includes(CARD_TITLE)) {
      return card as HTMLElement;
    }
  }
  return null;
}

function sortRows(nativeCard: HTMLElement) {
  const oldWraps = nativeCard.querySelectorAll(
    ".ft-ev-top, .ft-ev-bot, .ft-ev-fdb",
  );
  for (const wrap of oldWraps) {
    const p = wrap.parentElement!;
    while (wrap.firstChild) {
      p.insertBefore(wrap.firstChild, wrap);
    }
    wrap.remove();
  }
  nativeCard.querySelectorAll(".ft-ev-label").forEach((e) => e.remove());

  const rows = Array.from(
    nativeCard.querySelectorAll<HTMLElement>(
      ".flex.justify-between.w-full.items-center, .flex.flex-row.justify-between",
    ),
  );
  if (rows.length === 0) return;

  const parent = rows[0].parentElement!;
  parent.style.cssText = "display:flex;flex-direction:column;height:100%";

  const feedbackRows: HTMLElement[] = [];
  const evaluatorRows: HTMLElement[] = [];
  const evaluatedRows: HTMLElement[] = [];
  for (const row of rows) {
    row.style.fontSize = "0.9375rem";
    const text = row.textContent || "";
    if (text.includes("days left to feedback")) feedbackRows.push(row);
    else if (
      text.includes("You will evaluate") ||
      text.includes("You are ready to evaluate")
    )
      evaluatorRows.push(row);
    else if (text.includes("You will be evaluated by")) evaluatedRows.push(row);
  }

  if (feedbackRows.length > 0) {
    const fdbWrap = document.createElement("div");
    fdbWrap.className = "ft-ev-fdb";
    fdbWrap.style.cssText =
      "flex:1;display:flex;flex-direction:column;padding:0";
    parent.insertBefore(fdbWrap, parent.firstChild);

    const fdbLabel = document.createElement("div");
    fdbLabel.className = "ft-ev-label";
    fdbLabel.style.cssText =
      "font-weight:600;font-size:1rem;color:hsl(var(--foreground));margin:0 0 4px 4px;flex-shrink:0";
    fdbLabel.textContent = t("To Feedback ({n})", { n: feedbackRows.length });
    fdbWrap.insertBefore(fdbLabel, fdbWrap.firstChild);

    for (const row of feedbackRows) fdbWrap.appendChild(row);
  }

  const topWrap = document.createElement("div");
  topWrap.className = "ft-ev-top";
  topWrap.style.cssText =
    feedbackRows.length > 0
      ? "flex:1;display:flex;flex-direction:column;border-top:1px solid hsl(var(--border));padding:8px 0;margin-top:-1px"
      : "flex:1;display:flex;flex-direction:column;padding:0";
  parent.appendChild(topWrap);

  const botWrap = document.createElement("div");
  botWrap.className = "ft-ev-bot";
  botWrap.style.cssText =
    "flex:1;display:flex;flex-direction:column;border-top:1px solid hsl(var(--border));padding:8px 0;margin-top:-1px";
  parent.appendChild(botWrap);

  for (const row of evaluatorRows) topWrap.appendChild(row);
  for (const row of evaluatedRows) botWrap.appendChild(row);

  const evLabel = document.createElement("div");
  evLabel.className = "ft-ev-label";
  evLabel.style.cssText =
    "font-weight:600;font-size:1rem;color:hsl(var(--foreground));margin:0 0 4px 4px;flex-shrink:0";
  evLabel.textContent = t("Evaluator ({n})", { n: evaluatorRows.length });
  topWrap.insertBefore(evLabel, topWrap.firstChild);

  const edLabel = document.createElement("div");
  edLabel.className = "ft-ev-label";
  edLabel.style.cssText =
    "font-weight:600;font-size:1rem;color:hsl(var(--foreground));margin:4px 0 4px 4px;flex-shrink:0";
  edLabel.textContent = t("Evaluated ({n})", { n: evaluatedRows.length });
  botWrap.insertBefore(edLabel, botWrap.firstChild);

  nativeCard.querySelectorAll(".lucide-clock5").forEach((svg) => {
    const btn = svg.closest("button");
    if (btn) btn.style.fontSize = "0.80rem";
  });

  const hideBtn = findHideBtn(nativeCard);
  if (hideBtn) hideBtn.textContent = "Show";
}

function unsortRows(nativeCard: HTMLElement) {
  const fdbWrap = nativeCard.querySelector(".ft-ev-fdb");
  const topWrap = nativeCard.querySelector(".ft-ev-top");
  const botWrap = nativeCard.querySelector(".ft-ev-bot");
  if (!fdbWrap && !topWrap && !botWrap) return;

  const contentParent = (fdbWrap || topWrap || botWrap)!.parentElement!;

  if (fdbWrap) {
    while (fdbWrap.firstChild) {
      contentParent.insertBefore(fdbWrap.firstChild, fdbWrap);
    }
    fdbWrap.remove();
  }
  if (topWrap) {
    while (topWrap.firstChild) {
      contentParent.insertBefore(topWrap.firstChild, topWrap);
    }
    topWrap.remove();
  }
  if (botWrap) {
    while (botWrap.firstChild) {
      contentParent.appendChild(botWrap.firstChild);
    }
    botWrap.remove();
  }

  contentParent.querySelectorAll(".ft-ev-label").forEach((l) => l.remove());

  const rows = contentParent.querySelectorAll<HTMLElement>(
    ".flex.justify-between.w-full.items-center, .flex.flex-row.justify-between",
  );
  for (const row of rows) {
    row.style.fontSize = "";
  }

  contentParent.style.cssText = "";

  const hideBtn = findHideBtn(nativeCard);
  if (hideBtn) hideBtn.textContent = "Hide";
}

function findHideBtn(nativeCard: HTMLElement): HTMLElement | null {
  const btns = nativeCard.querySelectorAll<HTMLElement>("[class*='uppercase']");
  for (const btn of btns) {
    const text = btn.textContent?.trim().toLowerCase() || "";
    if (text === "hide" || text === "show") return btn;
  }
  return null;
}

/**
 * While the rows are grouped, the Intra's Hide button (relabelled "Show")
 * ungroups them and turns the extra off, instead of running the Intra's own
 * action: the rows sit in our wrappers then, and React re-rendering them from
 * there could fail on removeChild and take the dashboard down. Once they are
 * back in place the button is the Intra's again, as with the extra off.
 */
function hookToggleButton(nativeCard: HTMLElement) {
  const onClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const text = target.textContent?.trim().toLowerCase() || "";
    if (text !== "hide" && text !== "show") return;
    e.preventDefault();
    e.stopPropagation();
    nativeCard.removeEventListener("click", onClick);
    unsortRows(nativeCard);
    chrome.storage.local.set({ PROFILE_SHOW_EVALUATIONS: false });
  };
  nativeCard.addEventListener("click", onClick);
}

let evInitialized = false;

export async function initEvaluations() {
  if (evInitialized) return;
  evInitialized = true;

  if (
    location.hostname !== "profile-v3.intra.42.fr" ||
    !(location.pathname === "/" || location.pathname.startsWith("/users"))
  )
    return;

  // With the extra off (the default) the card and its Hide button stay the
  // Intra's: the button used to be taken over for everyone, and a click on it
  // regrouped the rows and switched this extra on in the hub.
  if (!(await getConfig("PROFILE_SHOW_EVALUATIONS"))) return;

  // Give up after ~10 s: pages without a pending-evaluations card (every
  // /users/* page, or a dashboard with nothing pending) used to run this
  // full-page text scan on every animation frame for the life of the tab.
  let attempts = 0;
  const MAX_ATTEMPTS = 600;
  const check = () => {
    if (attempts++ > MAX_ATTEMPTS) return;
    const native = findNativeCard();
    if (!native) {
      requestAnimationFrame(check);
      return;
    }
    const rows = native.querySelectorAll(
      ".flex.justify-between.w-full.items-center, .flex.flex-row.justify-between",
    );
    if (rows.length === 0) {
      requestAnimationFrame(check);
      return;
    }
    sortRows(native);
    hookToggleButton(native);
  };

  requestAnimationFrame(check);
}
