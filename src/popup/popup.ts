import { html, render } from "lit-html";
import { unsafeHTML } from "lit-html/directives/unsafe-html.js";
import { initAccountSettings } from "../features/account/account.ui";
import CSS from "../assets/style.css?inline";
import ICON_SVG from "../assets/svg/icon.svg?raw";
import { UPDATE_KEY, type UpdateInfo } from "../utils/update-check";
import { getEffectiveTheme } from "../features/profile/theme/theme-manager";

const style = document.createElement("style");
style.textContent = CSS;
document.head.appendChild(style);

function isIntraUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const { hostname, protocol } = new URL(url);
    if (protocol !== "https:") return false;
    return hostname === "intra.42.fr" || hostname.endsWith(".intra.42.fr");
  } catch {
    return false;
  }
}

function renderPlaceholder(container: HTMLElement) {
  render(
    html`
      <div
        class="w-full h-full flex flex-col items-center justify-center p-8 gap-4"
      >
        <div class="text-center flex flex-col items-center">
          <span
            class="size-16 flex items-center justify-center [&_svg]:size-full [&_polygon]:fill-current text-[#00babc]"
          >
            ${unsafeHTML(ICON_SVG)}
          </span>
          <h2 class="text-2xl font-bold mt-2">Better Intra</h2>
          <p class="opacity-70 mt-1">Works on Intra pages only.</p>
        </div>
        <button
          class="btn bg-[#00babc] text-white border-none hover:bg-[#1fd2d4] w-full max-w-sm h-14 text-base flex items-center justify-center gap-2 transition-colors duration-200 mt-4 font-bold"
          type="button"
          @click="${() =>
            window.open("https://profile-v3.intra.42.fr/", "_blank")}"
        >
          Open Intra
        </button>
      </div>
    `,
    container,
  );
}

/** Banner shown above the popup content when a newer GitHub release exists. */
async function renderUpdateBanner(root: HTMLElement) {
  const store = await chrome.storage.local.get(UPDATE_KEY);
  const info = store[UPDATE_KEY] as UpdateInfo | undefined;
  if (!info?.version || !info.url) return;
  const current = chrome.runtime.getManifest().version;
  const banner = document.createElement("div");
  banner.id = "update-banner";
  root.parentElement?.insertBefore(banner, root);
  render(
    html`
      <div
        class="flex items-center justify-between gap-3 px-4 py-2 bg-[#00babc] text-white text-sm"
      >
        <span>
          <strong>Better Intra ${info.version}</strong> is available
          <span class="opacity-80">(you have ${current})</span>
        </span>
        <a
          class="btn btn-xs bg-white text-[#00babc] border-none hover:bg-gray-100 font-bold"
          href="${info.url}"
          target="_blank"
          rel="noopener noreferrer"
          >Download</a
        >
      </div>
    `,
    banner,
  );
}

const REQUIRED_ORIGINS = [
  "https://*.intra.42.fr/*",
  "https://api.betterintra.com/*",
];

/**
 * Firefox (Manifest V3) does not grant host permissions automatically: the
 * extension then silently does nothing on the Intranet. Show a one-click fix.
 */
async function renderPermissionBanner(root: HTMLElement) {
  let granted = true;
  try {
    granted = await chrome.permissions.contains({ origins: REQUIRED_ORIGINS });
  } catch {
    return; // API unavailable: nothing we can do here
  }
  if (granted) return;
  const banner = document.createElement("div");
  banner.id = "permission-banner";
  root.parentElement?.insertBefore(banner, root);
  render(
    html`
      <div
        class="flex items-center justify-between gap-3 px-4 py-2 bg-warning text-warning-content text-sm"
      >
        <span>
          <strong>Site access required.</strong> Better Intra needs access to
          intra.42.fr and api.betterintra.com.
        </span>
        <button
          type="button"
          class="btn btn-xs font-bold"
          @click="${async () => {
            try {
              const ok = await chrome.permissions.request({
                origins: REQUIRED_ORIGINS,
              });
              if (ok) banner.remove();
            } catch {
              /* refused */
            }
          }}"
        >
          Allow
        </button>
      </div>
    `,
    banner,
  );
}

async function main() {
  const root = document.getElementById("account-root");
  if (!root) return;

  // The popup follows the extension theme (dark / light / system) instead of
  // being hard-wired to light; daisyUI picks the theme up from #popup-root.
  const popupRoot = document.getElementById("popup-root");
  if (popupRoot) {
    const theme = await getEffectiveTheme();
    popupRoot.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }

  await renderPermissionBanner(root);
  await renderUpdateBanner(root);
  // refresh the check in the background so the badge never stays stale
  void chrome.runtime.sendMessage({ type: "FT_CHECK_UPDATE" }).catch(() => {});

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const token = changes.CLOUD_TOKEN?.newValue;
    if (typeof token === "string" && token) {
      window.close();
    }
  });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (isIntraUrl(tab?.url)) {
    await initAccountSettings(root);
  } else {
    renderPlaceholder(root);
  }
}

void main();
