/**
 * Script-tag entry point — the build behind `dist/sdk.js`.
 *
 * This is the one integration path that needs no build tooling at all: drop a
 * <script> on the landing page and referral capture works. It reads the key off
 * its own tag, starts the SDK, and publishes `window.myAppAffiliate` so the page
 * can call `myAppAffiliate.identify(...)` at signup without importing anything.
 *
 *     <script
 *       src="https://cdn.jsdelivr.net/npm/@myappaffiliate/sdk-web@0/dist/sdk.js"
 *       data-api-key="pk_live_…"
 *       async
 *     ></script>
 *
 * No API host here either — `start` compiles the production one in, and reads
 * `data-api-base-url` off this same tag when an ops person needs to override it.
 *
 * Never throws: a missing key logs one warning and leaves `window.myAppAffiliate`
 * in place (unstarted calls are already no-ops), because a broken analytics
 * snippet must not take a customer's landing page down with it.
 */
import { myAppAffiliate, start } from "./index";

declare global {
  interface Window {
    myAppAffiliate?: typeof myAppAffiliate;
  }
}

/**
 * The <script> that loaded this bundle. `document.currentScript` is set while a
 * classic script executes — including an `async` one — and the query is the
 * fallback for the bundlers and tag managers that inject us some other way.
 */
function ownScript(): HTMLScriptElement | null {
  const current = document.currentScript as HTMLScriptElement | null;
  if (current?.hasAttribute("data-api-key")) return current;
  return document.querySelector<HTMLScriptElement>("script[data-api-key]");
}

function boot(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  window.myAppAffiliate = myAppAffiliate;

  const apiKey = ownScript()?.getAttribute("data-api-key")?.trim();
  if (!apiKey) {
    console.warn(
      "[myappaffiliate] script tag is missing data-api-key — referral capture is off. " +
        'window.myAppAffiliate.start("pk_live_…") still works.',
    );
    return;
  }

  // Floating promise on purpose: start() swallows its own failures, and the page
  // must not wait on a network call to finish rendering.
  void start(apiKey);
}

boot();
