/**
 * @maa/sdk-web — browser attribution SDK for MyAppAffiliate.
 *
 * Zero runtime dependencies. Works for SaaS websites and web apps: captures
 * referral codes (?via=) and claim tokens (?ct=) from the landing URL, fires
 * an install against the API, and binds the signed-up user via identify().
 * Every network failure is silent-safe — the SDK never throws into the host.
 * All calls are SSR-safe no-ops when `window` is undefined.
 */

/** Minimal synchronous storage; injectable for tests. Defaults to localStorage. */
export interface WebStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface InitOptions {
  /** SDK API key ("Bearer <sdkKey>"). */
  apiKey: string;
  /** e.g. "https://api.myappaffiliate.com". */
  baseUrl: string;
  /** Read via|ref|maa_code|code and claim_token|ct from location.search. Default true. */
  autoCapture?: boolean;
  /** Override storage (tests / cookie-based setups). Defaults to localStorage. */
  storage?: WebStorage;
}

export const DEVICE_ID_KEY = "maa_device_id";
export const PENDING_CODE_KEY = "maa_pending_code";
export const AFFILIATE_ID_KEY = "maa_affiliate_id";
export const ATTRIBUTION_ID_KEY = "maa_attribution_id";

const CODE_PARAMS = ["via", "ref", "maa_code", "code"] as const;
const TOKEN_PARAMS = ["claim_token", "ct"] as const;

interface State {
  apiKey: string;
  baseUrl: string;
  storage: WebStorage;
}

let state: State | null = null;

function isBrowser(): boolean {
  return typeof window !== "undefined";
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
    const res = await fetch(`${state.baseUrl.replace(/\/+$/, "")}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${state.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function storeAttribution(res: Record<string, unknown>): boolean {
  if (!state || typeof res.affiliateId !== "string") return false;
  state.storage.set(AFFILIATE_ID_KEY, res.affiliateId);
  if (typeof res.attributionId === "string") {
    state.storage.set(ATTRIBUTION_ID_KEY, res.attributionId);
  }
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
 * Initialize the SDK. Persists a stable device id, and (when autoCapture is on)
 * reads the referral code / claim token from the current URL. A captured code is
 * persisted ("maa_pending_code") so a later page view or signup still attributes
 * even if this first install call fails.
 */
export async function init(options: InitOptions): Promise<void> {
  if (!isBrowser()) return;
  state = {
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    storage: options.storage ?? localStorageAdapter(),
  };
  deviceId(); // ensure persisted immediately

  if (options.autoCapture ?? true) {
    const search = window.location?.search ?? "";
    const token = firstParam(search, TOKEN_PARAMS);
    if (token) {
      await attributeToken(token);
      return;
    }
    const code = firstParam(search, CODE_PARAMS);
    if (code) {
      await applyCode(code);
      return;
    }
  }

  // Retry a previously captured code that never made it to the API.
  const pending = state.storage.get(PENDING_CODE_KEY);
  if (pending && !state.storage.get(AFFILIATE_ID_KEY)) {
    await applyCode(pending);
  }
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

/** Bind your user id to this device's attribution (call after signup/login). */
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
