/**
 * The visuals editor dialog opened from my own avatar: its lifecycle (open,
 * load my settings, live preview, save to storage and the cloud, reset) and
 * the frame around the tabs (tab bar, connect screen, save button).
 *
 * The tabs themselves are in profile-modal-tabs.ts and the shared form types
 * and widgets in profile-modal-form.ts. The live preview paints through
 * visuals-apply.ts, never through visuals.ts: visuals.ts is what opens this
 * dialog, and importing it back would close an import cycle.
 */
import { html, render } from "lit-html";
import { unsafeHTML } from "lit-html/directives/unsafe-html.js";
import { getConfig, VISUAL_CLOUD_KEYS } from "../../../core/config.ts";
import {
  fetchMySettings,
  loginWith42,
  clearAuthFailed,
  syncMyVisuals,
} from "../../account/account.ts";
import { applyImgs, injectCustomStyles } from "./visuals-apply.ts";
import type { VisualUrls } from "./visuals-types.ts";
import { applyBadgeLayout } from "./badges.ts";
import { getEffectiveTheme } from "../../../core/theme/theme-manager.ts";
import { sharedStylesLink } from "../../../core/styles/shared-styles.ts";
import {
  addToHistory,
  type FormState,
  type ProfileTab,
} from "./profile-modal-form.ts";
import { renderTabPanels } from "./profile-modal-tabs.ts";
import FORTY_TWO_SVG from "../../../assets/svg/42_Logo.svg?raw";

let activeTab: ProfileTab = "avatar";

function renderPanelContent(
  state: FormState,
  currentTheme: string,
  onFormUpdate: (updates: Partial<FormState>) => void,
  history: { avatar: string[]; banner: string[]; background: string[] },
  onClearHistory: (key: "avatar" | "banner" | "background") => void,
  isConnected: boolean,
  needsReconnect: boolean,
  onConnect: () => void,
  onTabChange: (tab: ProfileTab) => void,
) {
  const tabItems: { id: ProfileTab; label: string }[] = [
    { id: "avatar", label: "Avatar" },
    { id: "banner", label: "Banner" },
    { id: "background", label: "Background" },
    { id: "badges", label: "Badges" },
  ];

  const panels = renderTabPanels(state, onFormUpdate, history, onClearHistory);

  return html`
    ${sharedStylesLink()}
    <style>
      :host { display: block; }
    </style>
    <div
      data-theme="${currentTheme}"
      class="flex flex-col p-4 gap-3 bg-base-100 rounded-2xl"
    >
      <div class="flex justify-between items-center shrink-0">
        <button
          type="button"
          id="profile-reset-btn"
          class="btn btn-outline btn-error btn-sm"
        >
          Reset
        </button>
        <button class="btn btn-circle btn-ghost btn-sm" id="profile-close-btn">
          ✕
        </button>
      </div>

      ${!isConnected
        ? html`
            <div
              class="flex flex-col items-center gap-4 py-12 px-6 text-center"
            >
              <p class="opacity-50 max-w-72 text-sm">
                ${needsReconnect
                  ? "Session expired. Reconnect to customize your profile pictures."
                  : "Connect your 42 account to customize your profile pictures."}
              </p>
              <button
                type="button"
                class="btn bg-[#00babc] text-white border-none hover:bg-[#1fd2d4] flex items-center justify-center gap-3 mt-2"
                style="height:3rem; min-width:15rem; font-size:1rem;"
                @click="${onConnect}"
              >
                <span class="font-bold tracking-wide"
                  >${needsReconnect ? "Reconnect" : "Connect with"}</span
                >
                <span
                  class="size-8 flex items-center justify-center [&_polygon]:fill-current"
                >
                  ${unsafeHTML(FORTY_TWO_SVG)}
                </span>
              </button>
            </div>
          `
        : html`
            <div role="tablist" class="tabs tabs-box shrink-0">
              ${tabItems.map(
                (tab) => html`
                  <button
                    type="button"
                    role="tab"
                    aria-selected="${activeTab === tab.id}"
                    class="tab ${activeTab === tab.id ? "tab-active" : ""}"
                    @click="${() => onTabChange(tab.id)}"
                  >
                    ${tab.label}
                  </button>
                `,
              )}
            </div>

            <div
              role="tabpanel"
              style="min-height: 260px;"
              class="flex flex-col"
            >
              ${panels[activeTab]}
            </div>

            <button
              id="profile-save"
              class="btn btn-success font-bold shrink-0"
            >
              Save Changes
            </button>
          `}
    </div>
  `;
}

export const createSettingsModal = async (
  onSaveCallback: (updatedVisuals: VisualUrls) => void,
) => {
  if (document.getElementById("profile-modal-host")) return;

  activeTab = "avatar";

  const token = await getConfig("CLOUD_TOKEN");
  const authFailed = !!(await getConfig("CLOUD_AUTH_FAILED"));
  const isConnected = !!token && !authFailed;
  const needsReconnect = !!token && authFailed;

  const presetKey = (await getConfig("PROFILE_THEME_PRESET")) || "dark";
  const currentTheme =
    presetKey !== "dark" && presetKey !== "light"
      ? presetKey
      : await getEffectiveTheme();

  const dialog = Object.assign(document.createElement("dialog"), {
    id: "profile-modal-host",
    className: "bg-transparent backdrop:bg-black/50",
  });
  Object.assign(dialog.style, {
    marginTop: "auto",
    marginBottom: "5vh",
    width: "min(820px, calc(100dvw - 1.5rem))",
    maxHeight: "92vh",
    borderRadius: "1.5rem",
    overflowY: "auto",
    padding: "0",
  });

  const content = document.createElement("div");
  content.style.cssText = "width:100%;display:flex;flex-direction:column;";
  dialog.appendChild(content);
  document.body.appendChild(dialog);

  const shadow = content.attachShadow({ mode: "open" });

  const skeleton = html`
    ${sharedStylesLink()}
    <style>
      :host { display: block; }
    </style>
    <div
      data-theme="${currentTheme}"
      class="flex flex-col p-4 gap-3 bg-base-100 rounded-2xl"
    >
      <div class="flex justify-between items-center">
        <div class="skeleton h-8 w-16"></div>
        <div class="skeleton h-8 w-8 rounded-full"></div>
      </div>
      <div class="flex gap-5">
        <div class="skeleton flex-1 h-64 rounded-xl"></div>
        <div class="skeleton flex-1 h-64 rounded-xl"></div>
      </div>
      <div class="flex gap-5">
        <div class="skeleton flex-1 h-48 rounded-xl"></div>
        <div class="skeleton flex-1 h-48 rounded-xl"></div>
      </div>
      <div class="skeleton h-12 w-full rounded-xl"></div>
    </div>
  `;

  render(skeleton, shadow);
  dialog.showModal();

  content.addEventListener("click", (e) => e.stopPropagation());
  // Escape triggers the native close without going through close(): the host
  // stayed in the DOM and the editor could not be reopened until a reload.
  dialog.addEventListener("close", () => dialog.remove());
  // `close` is declared further down; referencing it lazily avoids a
  // ReferenceError when the backdrop is clicked while settings are loading.
  dialog.addEventListener("click", () => dialog.close());

  if (isConnected) {
    const cloudSettings = await fetchMySettings();
    if (cloudSettings) {
      const visualData: Record<string, unknown> = {};
      for (const key of VISUAL_CLOUD_KEYS) {
        if (key in cloudSettings) {
          visualData[key] = (cloudSettings as Record<string, unknown>)[key];
        }
      }
      if (Object.keys(visualData).length > 0) {
        await chrome.storage.local.set(visualData);
      }
    }
  }

  const saved = {
    avatar: await getConfig("PROFILE_IMAGE_URL"),
    banner: await getConfig("PROFILE_BANNER_URL"),
    bannerMode: (await getConfig("PROFILE_BANNER_MODE")) || "fill",
    bannerColor: await getConfig("PROFILE_BANNER_COLOR"),
    background: await getConfig("PROFILE_BACKGROUND_URL"),
    backgroundMode: (await getConfig("PROFILE_BACKGROUND_MODE")) || "fill",
    backgroundColor: await getConfig("PROFILE_BACKGROUND_COLOR"),
    avatarBg: await getConfig("PROFILE_AVATAR_BG"),
    decoration: await getConfig("PROFILE_DECORATION"),
    avatarPosX: await getConfig("PROFILE_AVATAR_POSITION_X"),
    avatarPosY: await getConfig("PROFILE_AVATAR_POSITION_Y"),
    avatarScale: await getConfig("PROFILE_AVATAR_SCALE"),
    badgeBg: await getConfig("PROFILE_BADGE_BG"),
    badgeOrder: await getConfig("PROFILE_BADGE_ORDER"),
    badgeWrap: await getConfig("PROFILE_BADGE_WRAP"),
  };

  const state: FormState = { ...saved };

  const imgHistory = {
    avatar: await getConfig("PROFILE_IMAGE_HISTORY"),
    banner: await getConfig("PROFILE_BANNER_HISTORY"),
    background: await getConfig("PROFILE_BACKGROUND_HISTORY"),
  };

  if (saved.avatar)
    imgHistory.avatar = addToHistory(saved.avatar, imgHistory.avatar);
  if (saved.banner)
    imgHistory.banner = addToHistory(saved.banner, imgHistory.banner);
  if (saved.background)
    imgHistory.background = addToHistory(
      saved.background,
      imgHistory.background,
    );

  const close = () => {
    dialog.close();
    dialog.remove();
  };

  const reset = async () => {
    if (!confirm("Reset visuals?")) return;
    await chrome.storage.local.remove([
      "PROFILE_IMAGE_URL",
      "PROFILE_BANNER_URL",
      "PROFILE_BANNER_MODE",
      "PROFILE_BANNER_COLOR",
      "PROFILE_BACKGROUND_URL",
      "PROFILE_BACKGROUND_MODE",
      "PROFILE_BACKGROUND_COLOR",
      "PROFILE_AVATAR_BG",
      "PROFILE_DECORATION",
      "PROFILE_AVATAR_POSITION_X",
      "PROFILE_AVATAR_POSITION_Y",
      "PROFILE_AVATAR_SCALE",
      "PROFILE_BADGE_BG",
      "PROFILE_BADGE_ORDER",
      "PROFILE_BADGE_WRAP",
    ]);
    close();
    location.reload();
  };

  const handleConnect42 = () => {
    loginWith42(async () => {
      await clearAuthFailed();
      window.location.reload();
    });
  };

  const handleFormUpdate = (updates: Partial<FormState>) => {
    Object.assign(state, updates);
    liveApplyBannerBg(state);
    rerender();
  };

  const handleClearHistory = async (
    key: "avatar" | "banner" | "background",
  ) => {
    const historyKey =
      key === "avatar"
        ? "PROFILE_IMAGE_HISTORY"
        : key === "banner"
          ? "PROFILE_BANNER_HISTORY"
          : "PROFILE_BACKGROUND_HISTORY";
    imgHistory[key] = [];
    await chrome.storage.local.set({ [historyKey]: [] });
    rerender();
  };

  const rerender = () => {
    render(
      renderPanelContent(
        state,
        currentTheme,
        handleFormUpdate,
        imgHistory,
        handleClearHistory,
        isConnected,
        needsReconnect,
        handleConnect42,
        (tab) => {
          activeTab = tab;
          rerender();
        },
      ),
      shadow,
    );
    bindButtons(shadow, close, reset);
  };

  injectCustomStyles();
  rerender();

  if (isConnected) {
    shadow
      .querySelector("#profile-save")
      ?.addEventListener("click", async () => {
        const batchData: Record<string, string | number | boolean | string[]> =
          {};
        const keysToRemove: string[] = [];

        if (!state.avatar) {
          keysToRemove.push("PROFILE_IMAGE_URL");
        } else {
          batchData["PROFILE_IMAGE_URL"] = state.avatar;
        }

        if (!state.banner) {
          keysToRemove.push("PROFILE_BANNER_URL", "PROFILE_BANNER_MODE");
        } else {
          batchData["PROFILE_BANNER_URL"] = state.banner;
          batchData["PROFILE_BANNER_MODE"] = state.bannerMode;
        }

        if (!state.bannerColor) {
          keysToRemove.push("PROFILE_BANNER_COLOR");
        } else {
          batchData["PROFILE_BANNER_COLOR"] = state.bannerColor;
        }

        if (!state.background) {
          keysToRemove.push(
            "PROFILE_BACKGROUND_URL",
            "PROFILE_BACKGROUND_MODE",
          );
        } else {
          batchData["PROFILE_BACKGROUND_URL"] = state.background;
          batchData["PROFILE_BACKGROUND_MODE"] = state.backgroundMode;
        }

        if (!state.backgroundColor) {
          keysToRemove.push("PROFILE_BACKGROUND_COLOR");
        } else {
          batchData["PROFILE_BACKGROUND_COLOR"] = state.backgroundColor;
        }

        batchData["PROFILE_AVATAR_BG"] = state.avatarBg;
        batchData["PROFILE_DECORATION"] = state.decoration;
        batchData["PROFILE_AVATAR_POSITION_X"] = state.avatarPosX;
        batchData["PROFILE_AVATAR_POSITION_Y"] = state.avatarPosY;
        batchData["PROFILE_AVATAR_SCALE"] = state.avatarScale;

        if (!state.badgeBg) {
          keysToRemove.push("PROFILE_BADGE_BG");
        } else {
          batchData["PROFILE_BADGE_BG"] = state.badgeBg;
        }

        batchData["PROFILE_BADGE_ORDER"] = state.badgeOrder;
        batchData["PROFILE_BADGE_WRAP"] = state.badgeWrap;

        if (Object.keys(batchData).length > 0)
          await chrome.storage.local.set(batchData as Record<string, unknown>);
        if (keysToRemove.length > 0)
          await chrome.storage.local.remove(keysToRemove);

        imgHistory.avatar = addToHistory(state.avatar, imgHistory.avatar);
        imgHistory.banner = addToHistory(state.banner, imgHistory.banner);
        imgHistory.background = addToHistory(
          state.background,
          imgHistory.background,
        );
        await chrome.storage.local.set({
          PROFILE_IMAGE_HISTORY: imgHistory.avatar,
          PROFILE_BANNER_HISTORY: imgHistory.banner,
          PROFILE_BACKGROUND_HISTORY: imgHistory.background,
        });

        const updatedVisuals: VisualUrls = {
          avatar: state.avatar || "",
          banner: state.banner || "",
          bannerMode: state.bannerMode || "fill",
          bannerColor: state.bannerColor || "",
          background: state.background || "",
          backgroundMode: state.backgroundMode || "fill",
          backgroundColor: state.backgroundColor || "",
          avatarBg: state.avatarBg,
          decoration: state.decoration,
          avatarPosX: state.avatarPosX,
          avatarPosY: state.avatarPosY,
          avatarScale: state.avatarScale,
          badgeBg: state.badgeBg || "",
        };

        try {
          await syncMyVisuals(updatedVisuals);
        } catch (e) {
          console.error("Failed to sync visuals:", e);
        }
        onSaveCallback(updatedVisuals);
        close();
      });
  }
};

function liveApplyBannerBg(state: FormState) {
  applyImgs({
    avatar: "",
    banner: state.bannerColor ? "" : state.banner,
    bannerMode: state.bannerMode,
    bannerColor: state.bannerColor,
    background: state.backgroundColor ? "" : state.background,
    backgroundMode: state.backgroundMode,
    backgroundColor: state.backgroundColor,
    avatarBg: state.avatarBg,
    decoration: state.decoration,
    badgeBg: state.badgeBg,
  });
  applyBadgeLayout(document, {
    order: state.badgeOrder,
    wrap: state.badgeWrap,
  });
}

function bindButtons(shadow: ShadowRoot, close: () => void, reset: () => void) {
  const resetBtn = shadow.querySelector(
    "#profile-reset-btn",
  ) as HTMLElement | null;
  const closeBtn = shadow.querySelector(
    "#profile-close-btn",
  ) as HTMLElement | null;
  if (resetBtn && !resetBtn.dataset.bound) {
    resetBtn.addEventListener("click", reset);
    resetBtn.dataset.bound = "1";
  }
  if (closeBtn && !closeBtn.dataset.bound) {
    closeBtn.addEventListener("click", close);
    closeBtn.dataset.bound = "1";
  }
}
