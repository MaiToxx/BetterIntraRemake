/*
 * The harness's instrumentation, installed as a WebDriver BiDi preload script
 * (puppeteer page.evaluateOnNewDocument). Firefox runs it in the PAGE world
 * when the document is created, before the <html> element exists: before the
 * extension's document_start content script and before any page script. So
 * the page itself stays shaped like the real Intra (no extra script), and the
 * MutationObserver below sees every node the content script inserts, with its
 * time, including the hook.js <script> that is removed right after insertion.
 *
 * Everything is recorded in window.__smoke, which the harness reads back:
 *   - performance.now() when each watched node first appears;
 *   - every moz-extension:// <script> inserted (hook.js must be inserted once);
 *   - the gear click -> #hub-dialog open -> hub content rendered chain;
 *   - page errors, CSP violations, vite:preloadError events and the
 *     42_INTRAPY_TOKEN events hook.js dispatches;
 *   - every 42_LOGTIME_REQUEST event. The logtime module dispatches it once
 *     when it initialises (to ask hook.js for a replay), so there is one per
 *     instance of the app's module graph: a second instance shows up as a
 *     second event even when all its DOM writes are idempotent.
 *
 * MutationObserver callbacks run at the end of the task (microtask
 * checkpoint), so a time is when the inserting script finished its
 * synchronous run, not when it started. No innerHTML: DOM APIs only.
 */
(function () {
  "use strict";
  var now = function () {
    return performance.now();
  };

  var S = (window.__smoke = {
    preloadAt: now(),
    marks: {},
    extensionScripts: [],
    errors: [],
    rejections: [],
    csp: [],
    preloadErrors: [],
    tokenEvents: [],
    logtimeRequests: [],
    clicks: [],
    app: {},
  });

  var WATCH = {
    docElement: "html",
    head: "head",
    body: "body",
    themeLink: "link[data-better-intra-theme]",
    perfStyle: "#better-intra-perf",
    presetStyle: "#better-intra-theme-preset",
    customizeStyle: "#better-intra-customize",
    root: "#root",
    sidebar: 'a[href="https://profile-v3.intra.42.fr"]',
    gear: "#hub-gear-btn",
    clustersBtn: "#ft-clusters-btn",
    navAvatarTagged: "[data-ft-nav-avatar]",
    profileCardTagged: ".ft-profile-card",
    logtime: "#logtime-shadow-wrapper",
    hubDialog: "#hub-dialog",
  };
  var pending = Object.keys(WATCH);

  function scan() {
    for (var i = pending.length - 1; i >= 0; i--) {
      var name = pending[i];
      if (document.querySelector(WATCH[name])) {
        S.marks[name] = now();
        pending.splice(i, 1);
      }
    }
  }

  function noteScripts(records) {
    for (var r = 0; r < records.length; r++) {
      var added = records[r].addedNodes;
      for (var i = 0; i < added.length; i++) {
        var n = added[i];
        if (n.nodeName === "SCRIPT" && /^moz-extension:|^chrome-extension:/.test(n.src || "")) {
          var src = String(n.src);
          S.extensionScripts.push({ at: now(), file: src.replace(/^[a-z-]+:\/\/[^/]+\//, "") });
          if (/\/hook\.js$/.test(src) && !("hookInjected" in S.marks)) S.marks.hookInjected = now();
        }
      }
    }
  }

  /* ---- gear click -> dialog open -> hub content rendered -------------- */

  var armed = null;
  function checkHub() {
    if (!armed) return;
    var dialog = document.getElementById("hub-dialog");
    if (!dialog) return;
    if (armed.openAt === null && dialog.open) armed.openAt = now();
    if (armed.renderedAt === null) {
      var wrapper = document.getElementById("hub-shadow-wrapper");
      var root = wrapper && wrapper.shadowRoot;
      if (root) {
        if (root.querySelector('[role="tablist"]')) {
          armed.renderedAt = now();
        } else if (!armed.shadowObserved) {
          // Mutations inside a shadow root are not reported to an observer
          // of the document: watch the root itself.
          armed.shadowObserved = true;
          new MutationObserver(checkHub).observe(root, { childList: true, subtree: true });
        }
      }
    }
    if (armed.openAt !== null && armed.renderedAt !== null) armed = null;
  }

  document.addEventListener(
    "click",
    function (e) {
      var t = e.target;
      if (!t || !t.closest || !t.closest("#hub-gear-btn")) return;
      armed = {
        at: now(),
        openAt: null,
        renderedAt: null,
        shadowObserved: false,
        dialogExisted: !!document.getElementById("hub-dialog"),
      };
      S.clicks.push(armed);
    },
    true,
  );

  new MutationObserver(function (records) {
    noteScripts(records);
    if (pending.length) scan();
    if (armed) checkHub();
  }).observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["open"],
  });
  scan();

  /* ---- errors and events ------------------------------------------------ */

  window.addEventListener("error", function (e) {
    S.errors.push({ message: String(e.message), source: String(e.filename || ""), line: e.lineno || 0 });
  });
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    S.rejections.push(String((r && (r.stack || r.message)) || r));
  });
  document.addEventListener("securitypolicyviolation", function (e) {
    S.csp.push({
      directive: e.violatedDirective,
      blocked: String(e.blockedURI || ""),
      source: String(e.sourceFile || ""),
      disposition: e.disposition,
    });
  });
  window.addEventListener("vite:preloadError", function (e) {
    S.preloadErrors.push(String((e && e.payload) || "vite:preloadError"));
  });
  document.addEventListener("42_INTRAPY_TOKEN", function (e) {
    S.tokenEvents.push({ at: now(), detail: String(e.detail) });
  });
  document.addEventListener("42_LOGTIME_REQUEST", function () {
    S.logtimeRequests.push(now());
  });
  document.addEventListener("42_CAMPUS_DETECTED", function (e) {
    S.campusEventAt = now();
    S.campusEvent = String(e.detail);
  });
})();
