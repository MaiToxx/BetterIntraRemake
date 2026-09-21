/**
 * Waiting for the Intra DOM without polling.
 *
 * WHY: Intra v3 is a React app we do not control, so most features have to
 * wait for a node that is rendered later. Until now every one of them polled
 * (every 10 ms for `document.body`, 100 ms for a cluster tab, 250 ms for the
 * nav avatar, 500 ms for the sidebar and for the cluster map). A poll costs a
 * timer wake-up plus a `querySelector` on every tick, on every Intra page, for
 * the whole deadline - even on the many pages where the element never appears.
 * A MutationObserver costs nothing while the page is idle, and fires as soon
 * as the node lands, so the feature also mounts earlier than the next tick.
 *
 * Everything here degrades gracefully: without MutationObserver we fall back
 * to the old polling behaviour, and every watcher stops on `pagehide` so a
 * bfcached page leaves nothing running.
 */

/** Fallback tick used only when MutationObserver is unavailable. */
const FALLBACK_POLL_MS = 250;

const hasObserver = (): boolean => typeof MutationObserver === "function";

/** Attach a one-shot pagehide cleanup, tolerating environments without window. */
function onPageHide(stop: () => void): () => void {
  if (typeof addEventListener !== "function") return () => {};
  addEventListener("pagehide", stop, { once: true });
  return () => {
    if (typeof removeEventListener === "function") {
      removeEventListener("pagehide", stop);
    }
  };
}

export interface WaitForElementOptions {
  /** Give up after this many ms (default 5000). 0 means "check once". */
  timeoutMs?: number;
  /** Where to look and what to observe (default: the document). */
  root?: ParentNode & Node;
}

/**
 * Resolve with the first element matching `selector`, or null on timeout.
 *
 * Replaces `setInterval`/`requestAnimationFrame` polling loops: the node is
 * returned on the microtask right after it is inserted instead of on the next
 * tick, and an absent node costs one observer instead of N querySelectors.
 */
export function waitForElement<T extends Element>(
  selector: string,
  options: WaitForElementOptions = {},
): Promise<T | null> {
  const { timeoutMs = 5000, root } = options;
  const scope: ParentNode & Node =
    root ?? (document.documentElement || document);

  const found = scope.querySelector<T>(selector);
  if (found || timeoutMs <= 0) return Promise.resolve(found ?? null);

  return new Promise<T | null>((resolve) => {
    let done = false;
    let observer: MutationObserver | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let detachPageHide: () => void = () => {};

    const finish = (el: T | null) => {
      if (done) return;
      done = true;
      if (observer) observer.disconnect();
      if (timer !== null) clearTimeout(timer);
      if (poll !== null) clearInterval(poll);
      detachPageHide();
      resolve(el);
    };

    const check = () => {
      const el = scope.querySelector<T>(selector);
      if (el) finish(el);
    };

    detachPageHide = onPageHide(() => finish(null));
    timer = setTimeout(() => finish(scope.querySelector<T>(selector)), timeoutMs);

    if (hasObserver()) {
      observer = new MutationObserver(check);
      observer.observe(scope, { childList: true, subtree: true });
      // The node may have appeared between the first check and observe().
      check();
    } else {
      poll = setInterval(check, FALLBACK_POLL_MS);
    }
  });
}

export interface WatchDomOptions {
  /** Subtree to observe (default: the document element). */
  root?: Node;
  /** Stop watching after this many ms (default 10000). */
  timeoutMs?: number;
  /** Coalesce bursts that arrive within this window (default 0: one run per batch). */
  debounceMs?: number;
  /** Run the callback once before the first mutation (default true). */
  immediate?: boolean;
  /**
   * Also report text changes (default false). lit-html updates a text binding
   * in place (`Text.data = ...`), which is a characterData record, not a
   * childList one.
   */
  characterData?: boolean;
  /** Called once when the watcher stops, whatever the reason. */
  onStop?: () => void;
}

/**
 * Run `onBurst` once per burst of DOM mutations until it returns true (done)
 * or the deadline expires, then clean up.
 *
 * Replaces "re-try every 500 ms for N seconds" loops: on a quiet page the
 * callback never runs again, on a busy page it runs exactly when something
 * changed. Returns a stop function; the watcher also stops on `pagehide`.
 */
export function watchDom(
  onBurst: () => boolean | void,
  options: WatchDomOptions = {},
): () => void {
  const {
    root = document.documentElement || document,
    timeoutMs = 10000,
    debounceMs = 0,
    immediate = true,
    characterData = false,
    onStop,
  } = options;

  let stopped = false;
  let observer: MutationObserver | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  let deadline: ReturnType<typeof setTimeout> | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let detachPageHide: () => void = () => {};

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (observer) observer.disconnect();
    if (poll !== null) clearInterval(poll);
    if (deadline !== null) clearTimeout(deadline);
    if (debounce !== null) clearTimeout(debounce);
    detachPageHide();
    onStop?.();
  };

  const run = () => {
    if (stopped) return;
    if (onBurst() === true) stop();
  };

  const schedule = () => {
    if (stopped) return;
    if (debounceMs <= 0) {
      run();
      return;
    }
    if (debounce !== null) return;
    debounce = setTimeout(() => {
      debounce = null;
      run();
    }, debounceMs);
  };

  detachPageHide = onPageHide(stop);
  if (timeoutMs > 0) deadline = setTimeout(stop, timeoutMs);

  if (immediate) run();
  if (stopped) return stop;

  if (hasObserver()) {
    observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true, characterData });
  } else {
    poll = setInterval(run, FALLBACK_POLL_MS);
  }

  return stop;
}

export interface TickWhileVisibleOptions {
  /**
   * Stop for good once this node has left the DOM (checked before every
   * tick): a clock nobody can see any more must not keep the timer alive.
   */
  element?: Node | null;
  /**
   * What to do when the tab becomes visible again.
   * true (default): tick at once and restart the cadence from there - right
   *   for a clock or countdown computed from Date.now(), which is then
   *   correct again immediately.
   * false: keep the cadence's phase - tick at once only if a tick is overdue,
   *   otherwise wait for the rest of the period. Right for a network poll.
   */
  resyncOnVisible?: boolean;
}

const pageHidden = (): boolean =>
  typeof document !== "undefined" && document.visibilityState === "hidden";

/**
 * `setInterval(tick, intervalMs)` for something the user watches, that only
 * runs while the tab is visible.
 *
 * WHY: a 1 s countdown in a background tab still wakes the browser up once a
 * second (the minimum timer throttling allows) to paint digits nobody sees.
 * Here the timer is cleared while `document.hidden` and on `pagehide`, then
 * resumed on `visibilitychange` / a bfcache `pageshow`. While the tab is
 * visible the cadence is exactly the setInterval one.
 *
 * `tick` returns true when it is done. Returns a stop function.
 */
export function tickWhileVisible(
  tick: () => boolean | void,
  intervalMs: number,
  options: TickWhileVisibleOptions = {},
): () => void {
  const { element = null, resyncOnVisible = true } = options;

  let stopped = false;
  let interval: ReturnType<typeof setInterval> | null = null;
  let kick: ReturnType<typeof setTimeout> | null = null;
  // The caller has just drawn the current value: that counts as a tick.
  let lastTick = Date.now();

  const clear = () => {
    if (interval !== null) clearInterval(interval);
    if (kick !== null) clearTimeout(kick);
    interval = null;
    kick = null;
  };

  const run = () => {
    if (stopped) return;
    if (element && !element.isConnected) {
      stop();
      return;
    }
    lastTick = Date.now();
    if (tick() === true) stop();
  };

  /** Start the cadence, the first tick `firstDelay` ms from now. */
  const arm = (firstDelay: number) => {
    clear();
    if (stopped) return;
    if (firstDelay >= intervalMs) {
      interval = setInterval(run, intervalMs);
      return;
    }
    kick = setTimeout(() => {
      kick = null;
      // Armed before the tick, so that a tick that throws does not end the
      // cadence (it does not end a setInterval either).
      interval = setInterval(run, intervalMs);
      run();
    }, Math.max(0, firstDelay));
  };

  const resume = () => {
    if (stopped || interval !== null || kick !== null) return;
    const elapsed = Date.now() - lastTick;
    if (resyncOnVisible || elapsed >= intervalMs) {
      arm(intervalMs);
      run();
    } else {
      arm(intervalMs - elapsed);
    }
  };

  const onVisibility = () => {
    if (pageHidden()) clear();
    else resume();
  };
  const onPageHide = () => clear();
  const onPageShow = (e: Event) => {
    if ((e as PageTransitionEvent).persisted && !pageHidden()) resume();
  };

  const hasWindow = typeof addEventListener === "function";
  const hasDocument = typeof document !== "undefined";

  function stop() {
    if (stopped) return;
    stopped = true;
    clear();
    if (hasDocument) {
      document.removeEventListener("visibilitychange", onVisibility);
    }
    if (hasWindow) {
      removeEventListener("pagehide", onPageHide);
      removeEventListener("pageshow", onPageShow);
    }
  }

  if (hasDocument) document.addEventListener("visibilitychange", onVisibility);
  if (hasWindow) {
    addEventListener("pagehide", onPageHide);
    addEventListener("pageshow", onPageShow);
  }
  // Started in a background tab: nothing runs until the tab is shown.
  if (!pageHidden()) arm(intervalMs);

  return stop;
}
