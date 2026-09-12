/**
 * Script-tag entry point — the build behind `dist/sdk.js`.
 *
 * This is the one integration path that needs no build tooling at all: drop a
 * <script> on the landing page and referral capture works. It self-configures
 * from the tag's data attributes and publishes the SDK on `window.maa`, so the
 * page can call `maa.identify(...)` at signup without importing anything.
 *
 *     <script
 *       src="https://cdn.jsdelivr.net/npm/@myappaffiliate/sdk-web@0/dist/sdk.js"
 *       data-api-key="pk_live_…"
 *       data-base-url="https://api.myappaffiliate.com"
 *       async
 *     ></script>
 *
 * Never throws: a missing attribute logs one warning and leaves `window.maa`
 * in place (unconfigured calls are already no-ops), because a broken analytics
 * snippet must not take a customer's landing page down with it.
 */
import { type InitOptions, init, maa } from "./index";

declare global {
  interface Window {
    maa?: typeof maa;
  }
}

/**
 * The <script> that loaded this bundle. `document.currentScript` is set while a
 * classic script executes — including an `async` one — and the query is the
 * fallback for the bundlers and tag managers that inject us some other way.
 */
function ownScript(): HTMLScriptElement | null {
  const current = document.currentScript;
  if (current && current.tagName === "SCRIPT") return current as HTMLScriptElement;
  return document.querySelector<HTMLScriptElement>("script[data-api-key][data-base-url]");
}

function boot(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  window.maa = maa;

  const script = ownScript();
  const apiKey = script?.dataset.apiKey;
  const baseUrl = script?.dataset.baseUrl;
  if (!apiKey || !baseUrl) {
    console.warn(
      "[myappaffiliate] script tag is missing data-api-key or data-base-url — " +
        "referral capture is off. window.maa.configure({ apiKey, baseUrl }) still works.",
    );
    return;
  }

  const options: InitOptions = { apiKey, baseUrl };
  if (script?.dataset.autoCapture === "false") options.autoCapture = false;

  // Floating promise on purpose: init() swallows its own failures, and the page
  // must not wait on a network call to finish rendering.
  void init(options);
}

boot();
