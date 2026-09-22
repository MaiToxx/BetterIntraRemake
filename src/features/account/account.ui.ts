import { html, render } from "lit-html";
import { unsafeHTML } from "lit-html/directives/unsafe-html.js";
import {
  getCloudLogin,
  getLastKnownSessions,
  refreshSessionCount,
} from "./account.ts";
import { getConfig } from "../../core/config.ts";
import FORTY_TWO_SVG from "../../assets/svg/42_Logo.svg?raw";
import { AccountState, createInitialState } from "./state.ts";
import { createHandlers } from "./handlers.ts";

function renderAccountTab(
  state: AccountState,
  handlers: ReturnType<typeof createHandlers>,
): ReturnType<typeof html> {
  const isConnected = state.cloud === "online";
  const statusClass =
    state.cloud === "checking"
      ? "badge-ghost"
      : isConnected
        ? "badge-success"
        : "badge-warning";
  const statusText =
    state.cloud === "checking"
      ? "Checking..."
      : isConnected
        ? "Connected"
        : "Offline";

  if (!state.token) {
    return html`
      <div
        class="w-full h-full flex flex-col items-center justify-center p-8 gap-4"
      >
        <div class="text-center">
          ${state.needsReconnect
            ? html`<h2 class="text-2xl font-bold">Session expired</h2>
                <p class="opacity-70 mt-1">Reconnect to restore features.</p>`
            : html`<h2 class="text-2xl font-bold">Connect your Account</h2>
                <p class="opacity-70 mt-1">
                  Sync your settings across devices.
                </p>`}
        </div>
        <button
          class="btn bg-[#00babc] text-white border-none hover:bg-[#1fd2d4] w-full max-w-sm h-16 text-lg flex items-center justify-center gap-3 transition-colors duration-200 mt-4"
          type="button"
          @click="${handlers.handleLogin42}"
        >
          <span class="font-bold tracking-wide text-base">Connect with</span>
          <span
            class="size-10 flex items-center justify-center [&_polygon]:fill-current"
          >
            ${unsafeHTML(FORTY_TWO_SVG)}
          </span>
        </button>
      </div>
    `;
  }

  return html`
    <div class="w-full h-full flex flex-col gap-4 overflow-y-auto">
      ${state.needsReconnect
        ? html`<div
            class="alert alert-warning shadow-lg rounded-xl flex items-center justify-between"
          >
            <span class="text-sm font-semibold">Session expired</span>
            <button
              class="btn btn-warning btn-sm font-bold"
              type="button"
              @click="${handlers.handleLogin42}"
            >
              Reconnect
            </button>
          </div>`
        : ""}
      <!-- Top Section: Status & Sync Info -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <!-- Left Card: Account Status -->
        <div
          class="bg-base-200 shadow-md p-5 rounded-xl border border-base-300"
        >
          <h2 class="text-lg font-bold text-base-content mb-4">
            Account Status
          </h2>
          <div class="flex flex-col gap-3">
            <div
              class="flex items-center justify-between bg-base-100 p-3 rounded-lg border border-base-300"
            >
              <span class="font-medium text-sm text-base-content">Login</span>
              <div
                class="badge badge-info font-mono font-bold text-info-content"
              >
                ${state.login}
              </div>
            </div>
            <div
              class="flex items-center justify-between bg-base-100 p-3 rounded-lg border border-base-300"
            >
              <span class="font-medium text-sm text-base-content"
                >Cloud Status</span
              >
              <div class="badge ${statusClass} font-bold">
                ${statusText}
              </div>
            </div>
            <div
              class="flex items-center justify-between bg-base-100 p-3 rounded-lg border border-base-300"
            >
              <span class="font-medium text-sm text-base-content"
                >Sessions</span
              >
              <div class="badge badge-success font-bold text-success-content">
                ${state.activeSessions ?? "?"}/10
              </div>
            </div>
          </div>
        </div>

        <!-- Right Card: Cloud Sync -->
        <div
          class="bg-base-200 shadow-md p-5 rounded-xl border border-base-300"
        >
          <h2 class="text-lg font-bold text-base-content mb-4">Cloud Sync</h2>
          <div class="grid grid-cols-2 gap-3">
            <!-- Pull Button -->
            <button
              id="pull-cloud-btn"
              class="btn btn-info font-bold transition-all text-info-content text-base row-span-2 py-8 w-full ${state
                .buttons.pull.loading
                ? "loading"
                : state.buttons.pull.success
                  ? "btn-success text-success-content"
                  : state.buttons.pull.error
                    ? "btn-error text-error-content"
                    : ""}"
              type="button"
              ?disabled="${state.buttons.pull.loading}"
              @click="${handlers.handlePull}"
            >
              ${state.buttons.pull.loading
                ? "Pulling..."
                : state.buttons.pull.text}
            </button>

            <!-- Push Button -->
            <button
              id="push-cloud-btn"
              class="btn btn-success text-success-content font-bold transition-all text-base row-span-2 py-8 w-full ${state
                .buttons.push.loading
                ? "loading"
                : state.buttons.push.success
                  ? "btn-success text-success-content"
                  : state.buttons.push.error
                    ? "btn-error text-error-content"
                    : ""}"
              type="button"
              ?disabled="${state.buttons.push.loading}"
              @click="${handlers.handlePush}"
            >
              ${state.buttons.push.loading
                ? "Pushing..."
                : state.buttons.push.text}
            </button>
          </div>
        </div>
      </div>

      <!-- Bottom Section: Action Buttons -->
      <div class="flex justify-between gap-4 mt-auto pt-4">
        <button
          class="btn btn-error text-error-content font-bold transition-all text-base"
          type="button"
          @click="${handlers.handleDelete}"
        >
          Disconnect
        </button>
        <button
          class="btn btn-error text-error-content font-bold transition-all text-base"
          type="button"
          @click="${handlers.handleWipe}"
        >
          Wipe All Data
        </button>
      </div>
    </div>
  `;
}

export async function initAccountSettings(container: HTMLElement) {
  const state = createInitialState();
  const handlers = createHandlers(state, update);

  // Storage only, never the network: the card used to wait for the worker's
  // answer before its first paint, so a slow or blackholed worker left the
  // popup blank for as long as the browser's own connection timeout.
  async function update() {
    state.login = await getCloudLogin();
    state.token = (await getConfig("CLOUD_TOKEN")) || "";
    state.needsReconnect = !!(await getConfig("CLOUD_AUTH_FAILED"));
    render(renderAccountTab(state, handlers), container);
  }

  async function refreshCloud() {
    if (!state.token || !state.login) return;
    const count = await refreshSessionCount();
    if (count !== null) {
      state.activeSessions = count;
      state.cloud = "online";
    } else {
      state.cloud = "offline";
    }
    // Set by the request itself on a 401: read after it, or the first popup
    // after a session expiry says "Offline" and only offers Reconnect on the
    // next re-render.
    state.needsReconnect = !!(await getConfig("CLOUD_AUTH_FAILED"));
    render(renderAccountTab(state, handlers), container);
  }

  state.activeSessions = await getLastKnownSessions();
  await update();
  void refreshCloud();
}
