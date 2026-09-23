declare module "*.css" {
  const content: any;
  export default content;
}
declare module "*.css?inline" {
  const content: any;
  export default content;
}
declare module "*.svg" {
  const content: string;
  export default content;
}
declare module "*.svg?raw" {
  const content: string;
  export default content;
}
declare const __APP_VERSION__: string;
declare const __TS_VERSION__: string;
declare const __VITE_VERSION__: string;
declare const __TW_VERSION__: string;
declare const __LIT_VERSION__: string;
declare const __DAISY_VERSION__: string;
declare const __WEB_EXT_VERSION__: string;

declare const __REPO_URL__: string;
declare const __REPO_RELEASES_API__: string;

declare const __WORKER_URL__: string;

declare const __AUTH_MODE__: string;

/** True only in the Chrome Web Store package (CHROME_STORE=1): see vite.config.ts. */
declare const __STORE_BUILD__: boolean;

/** The browser this build is for (background build only; "firefox" in tests). */
declare const __TARGET__: "firefox" | "chrome";
