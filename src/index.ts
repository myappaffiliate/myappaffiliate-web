/**
 * @maa/sdk-web — browser attribution SDK for MyAppAffiliate.
 *
 * The whole integration is one line:
 *
 *     myAppAffiliate.start("pk_live_…");
 *
 * …plus `identify(userId)` once you know who the user is. `start` resolves the
 * API host itself, captures `?via=` / `?ct=` from the landing URL, keeps
 * capturing across client-side route changes, and retries anything an offline
 * first visit failed to deliver.
 *
 * Everything beyond that — a different host, your own storage, manual capture —
 * is an optional field on the options object, never a required argument.
 *
 * Zero runtime dependencies. Every network failure is silent-safe: the SDK
 * never throws into the host page. All calls are SSR-safe no-ops when `window`
 * is undefined.
 */

/**
 * Where the SDK talks to when nothing overrides it. Mirrors `SITE.api` in
 * @maa/brand — inlined rather than imported so this package stays
 * dependency-free for a customer's bundler.
 */
export const DEFAULT_API_BASE_URL = "https://api.myappaffiliate.com";

/** Minimal synchronous storage; injectable for tests. Defaults to localStorage. */
export interface WebStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface StartOptions {
  /** Your SDK key from the dashboard ("pk_live_…"). The only required field. */
  apiKey: string;
  /**
   * Override the API host. You do NOT need this in production — it defaults to
   * {@link DEFAULT_API_BASE_URL}. Set it only to point at a staging API or a
   * self-hosted deployment.
   *
   * Resolution order: this field → `<script data-api-base-url>` →
   * `globalThis.MAA_API_BASE_URL` → the default.
   */
  apiBaseUrl?: string;
  /** Read via|ref|maa_code|code and claim_token|ct from location.search. Default true. */
  autoCapture?: boolean;
  /**
   * Keep capturing after client-side route changes (pushState/replaceState/
   * popstate). Default true — it is why an SPA needs no `capture()` call of its
   * own. Requires `autoCapture`.
   */
  spa?: boolean;
  /** Override storage (tests / cookie-based setups). Defaults to localStorage. */
  storage?: WebStorage;
  /** Log what the SDK decided, to the console. Off by default. */
  debug?: boolean;
}

export const DEVICE_ID_KEY = "maa_device_id";
export const PENDING_CODE_KEY = "maa_pending_code";
export const AFFILIATE_ID_KEY = "maa_affiliate_id";
export const ATTRIBUTION_ID_KEY = "maa_attribution_id";

const CODE_PARAMS = ["via", "ref", "maa_code", "code"] as const;
const TOKEN_PARAMS = ["claim_token", "ct"] as const;

interface State {
  apiKey: string;
  apiBaseUrl: string;
  storage: WebStorage;
  debug: boolean;
}

let state: State | null = null;
/** Set once the SPA listeners are installed, so a second start() doesn't stack them. */
let spaWired = false;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function log(message: string, detail?: unknown): void {
  if (!state?.debug) return;
  if (detail === undefined) console.info(`[myappaffiliate] ${message}`);
  else console.info(`[myappaffiliate] ${message}`, detail);
}

/** localStorage can throw (Safari private mode, disabled cookies) — swallow everything. */
function localStorageAdapter(): WebStorage {
  return {
    get(key) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        /* silent */
      }
    },
    remove(key) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* silent */
      }
    },
  };
}

/**
 * The API host, without the customer typing one.
 *
 * A hard-coded host in application code is the thing customers get wrong: it
 * gets copied between environments, or pasted with a trailing path. So the
 * default is compiled in, and the two escape hatches are places an ops person
 * can set a value without touching a source file.
 */
function resolveApiBaseUrl(explicit?: string): string {
  const fromGlobal = (globalThis as { MAA_API_BASE_URL?: unknown }).MAA_API_BASE_URL;
  const candidate =
    present(explicit) ??
    present(scriptAttribute("data-api-base-url")) ??
    present(typeof fromGlobal === "string" ? fromGlobal : undefined);
  // Trailing slashes stripped after the fallback, so a blank override (an empty
  // data attribute, an unset build-time global) falls through to the default
  // instead of becoming a base URL of "".
  return (candidate ?? DEFAULT_API_BASE_URL).replace(/\/+$/, "");
}

/** Trimmed value, or undefined when absent/blank — a blank override means "unset". */
function present(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Read a data-attribute off our own <script> tag, so a `<script src=… data-api-key=…>`
 * install needs no inline JS at all.
 */
function scriptAttribute(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  // `currentScript` is only set while a script is executing, so a bundled app
  // calling start() from a module or a callback sees null — hence the lookup by
  // attribute as the fallback.
  const current = document.currentScript as HTMLScriptElement | null;
  const tag =
    current?.hasAttribute("data-api-key") === true
      ? current
      : document.querySelector<HTMLScriptElement>("script[data-api-key]");
  return tag?.getAttribute(name) ?? undefined;
}

function generateId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `maa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function deviceId(): string {
  if (!state) return "";
  let id = state.storage.get(DEVICE_ID_KEY);
  if (!id) {
    id = generateId();
    state.storage.set(DEVICE_ID_KEY, id);
  }
  return id;
}

/** POST JSON; returns the parsed body on 2xx, null on any failure. Never throws. */
async function post(path: string, body: unknown): Promise<Record<string, unknown> | null> {
  if (!state) return null;
  try {
    const res = await fetch(`${state.apiBaseUrl}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${state.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      log(`${path} → ${res.status}`);
      return null;
    }
    return (await res.json()) as Record<string, unknown>;
  } catch (error) {
    log(`${path} failed`, error);
    return null;
  }
}

function storeAttribution(res: Record<string, unknown>): boolean {
  if (!state || typeof res.affiliateId !== "string") return false;
  state.storage.set(AFFILIATE_ID_KEY, res.affiliateId);
  if (typeof res.attributionId === "string") {
    state.storage.set(ATTRIBUTION_ID_KEY, res.attributionId);
  }
  log(`attributed to ${res.affiliateId}`);
  return true;
}

function firstParam(search: string, names: readonly string[]): string | null {
  const params = new URLSearchParams(search);
  for (const name of names) {
    const value = params.get(name);
    if (value) return value;
  }
  return null;
}

/**
 * Re-run capture after client-side navigation.
 *
 * A single-page app changes the URL without reloading, so a creator link to a
 * deep route (`/pricing?via=LUMI`) would otherwise be captured only if it
 * happened to be the entry page. Patching the history methods means the app
 * author writes no router glue at all.
 */
function wireSpaCapture(): void {
  if (spaWired || typeof window === "undefined" || !window.history) return;
  spaWired = true;

  const rerun = () => void capture();
  for (const name of ["pushState", "replaceState"] as const) {
    const original = window.history[name];
    if (typeof original !== "function") continue;
    window.history[name] = function patched(
      this: History,
      ...args: Parameters<History["pushState"]>
    ) {
      const result = original.apply(this, args);
      rerun();
      return result;
    } as History[typeof name];
  }
  window.addEventListener("popstate", rerun);
}

/**
 * Start the SDK. Pass just your key:
 *
 *     myAppAffiliate.start("pk_live_…");
 *
 * Persists a stable device id, captures the referral from the current URL, and
 * (unless you turn it off) keeps capturing across client-side route changes. A
 * captured code is persisted before the network call, so a later page view or
 * signup still attributes even if this first call fails.
 */
export async function start(options: StartOptions | string): Promise<void> {
  if (!isBrowser()) return;
  const opts: StartOptions = typeof options === "string" ? { apiKey: options } : options;
  state = {
    apiKey: opts.apiKey,
    apiBaseUrl: resolveApiBaseUrl(opts.apiBaseUrl),
    storage: opts.storage ?? localStorageAdapter(),
    debug: opts.debug ?? false,
  };
  log(`started against ${state.apiBaseUrl}`);
  deviceId(); // ensure persisted immediately

  const autoCapture = opts.autoCapture ?? true;
  if (autoCapture && (opts.spa ?? true)) wireSpaCapture();
  if (autoCapture && (await capture())) return;

  // Retry a previously captured code that never made it to the API.
  const pending = state.storage.get(PENDING_CODE_KEY);
  if (pending && !state.storage.get(AFFILIATE_ID_KEY)) {
    await applyCode(pending);
  }
}

/**
 * Scan the current URL for a referral and claim it. Called for you by `start`
 * and on every client-side route change; call it yourself only if you disabled
 * `spa` capture. Returns true when something was found and claimed.
 */
export async function capture(): Promise<boolean> {
  if (!isBrowser() || !state) return false;
  const search = window.location?.search ?? "";
  const token = firstParam(search, TOKEN_PARAMS);
  if (token) return attributeToken(token);
  const code = firstParam(search, CODE_PARAMS);
  if (code) return applyCode(code);
  return false;
}

/**
 * Claim a referral from an explicit URL — for cases where you have the link but
 * the browser is not on it (a captured deferred link, a custom router).
 */
export async function attribute(url: string): Promise<boolean> {
  if (!isBrowser() || !state || !url) return false;
  // slice(1).join keeps everything after the FIRST "?" — a stray second one in
  // a redirect-style URL must not truncate the params that follow it.
  const search = url.split("#")[0]?.split("?").slice(1).join("?") ?? "";
  const token = firstParam(search, TOKEN_PARAMS);
  if (token) return attributeToken(token);
  const code = firstParam(search, CODE_PARAMS);
  if (code) return applyCode(code);
  return false;
}

/** Attribute this device to an affiliate by referral code. Silent-safe. */
export async function applyCode(code: string): Promise<boolean> {
  if (!isBrowser() || !state || !code) return false;
  state.storage.set(PENDING_CODE_KEY, code);
  const res = await post("/sdk/install", {
    deviceId: deviceId(),
    affiliateCode: code,
    firstOpenAt: Date.now(),
  });
  if (!res) return false;
  return storeAttribution(res);
}

/** Redeem a short-lived click claim token (?claim_token= / ?ct=). Silent-safe. */
export async function attributeToken(claimToken: string): Promise<boolean> {
  if (!isBrowser() || !state || !claimToken) return false;
  const res = await post("/sdk/install", {
    deviceId: deviceId(),
    claimToken,
    firstOpenAt: Date.now(),
  });
  if (!res) return false;
  return storeAttribution(res);
}

/**
 * Bind your user id to this device's attribution — call it once, right after
 * signup or login.
 *
 * This id is the join key for every revenue event that follows, whoever bills
 * the customer: it must be the same string your billing provider reports back
 * to us (Stripe `metadata.customer_user_id`, Paddle custom data, RevenueCat /
 * Adapty / Superwall app user id).
 */
export async function identify(userId: string): Promise<boolean> {
  if (!isBrowser() || !state || !userId) return false;
  const res = await post("/sdk/identify", {
    deviceId: deviceId(),
    customerUserId: userId,
    identifiedAt: Date.now(),
  });
  return res !== null;
}

/** The affiliate id this device attributed to, or null if unattributed. */
export function attributedAffiliateId(): string | null {
  if (!isBrowser() || !state) return null;
  return state.storage.get(AFFILIATE_ID_KEY);
}

/** Clear all persisted SDK state (device id, pending code, attribution). */
export function reset(): void {
  if (!isBrowser() || !state) return;
  state.storage.remove(DEVICE_ID_KEY);
  state.storage.remove(PENDING_CODE_KEY);
  state.storage.remove(AFFILIATE_ID_KEY);
  state.storage.remove(ATTRIBUTION_ID_KEY);
}

/**
 * The namespaced surface — the same `MyAppAffiliate.start(...)` /
 * `.identify(...)` shape every other platform's SDK exposes, so moving between
 * them is a rename and nothing more.
 */
export const myAppAffiliate = {
  start,
  identify,
  capture,
  attribute,
  applyCode,
  attributeToken,
  attributedAffiliateId,
  reset,
} as const;

export default myAppAffiliate;
