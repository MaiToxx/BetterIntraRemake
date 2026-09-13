/**
 * Base URL of the Better Intra cloud worker.
 *
 * Injected at build time from package.json -> "config.workerUrl" (see
 * scripts/repo-info.js). Defaults to the upstream instance; point it at your
 * own deployment of better-intra-worker to self-host (docs/SELF-HOSTING.md).
 */
export const WORKER_URL: string = __WORKER_URL__.replace(/\/+$/, "");

/** Host of the worker, e.g. "api.betterintra.com" (for user-facing text). */
export const WORKER_HOST: string = new URL(WORKER_URL).host;

/** Match pattern covering every worker URL (host permissions). */
export const WORKER_ORIGIN_PATTERN: string = `${new URL(WORKER_URL).origin}/*`;
