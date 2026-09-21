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
    observer.observe(root, { childList: true, subtree: true });
  } else {
    poll = setInterval(run, FALLBACK_POLL_MS);
  }

  return stop;
}
