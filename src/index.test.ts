import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AFFILIATE_ID_KEY,
  ATTRIBUTION_ID_KEY,
  DEVICE_ID_KEY,
  PENDING_CODE_KEY,
  type WebStorage,
  applyCode,
  attributeToken,
  attributedAffiliateId,
  identify,
  init,
  reset,
} from "./index";

function memoryStorage(seed: Record<string, string> = {}): WebStorage & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(seed));
  return {
    data,
    get: (key) => data.get(key) ?? null,
    set: (key, value) => void data.set(key, value),
    remove: (key) => void data.delete(key),
  };
}

function okFetch(
  body: Record<string, unknown> = { attributionId: "attr_1", affiliateId: "aff_1" },
) {
  return vi.fn(async () => ({ ok: true, json: async () => body }));
}

function stubWindow(search: string) {
  vi.stubGlobal("window", { location: { search } });
}

/** Parse the JSON body of the nth fetch call. */
function sentBody(fetchMock: ReturnType<typeof vi.fn>, call = 0): Record<string, unknown> {
  const args = fetchMock.mock.calls[call];
  if (!args) throw new Error(`fetch not called ${call + 1} times`);
  return JSON.parse((args[1] as { body: string }).body) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("init", () => {
  it("generates and persists a device id, stable across inits", async () => {
    stubWindow("");
    vi.stubGlobal("fetch", okFetch());
    const storage = memoryStorage();
    await init({ apiKey: "k", baseUrl: "https://api.test", storage });
    const first = storage.get(DEVICE_ID_KEY);
    expect(first).toBeTruthy();
    await init({ apiKey: "k", baseUrl: "https://api.test", storage });
    expect(storage.get(DEVICE_ID_KEY)).toBe(first);
  });

  it("auto-captures ?via= into an install call and persists the pending code", async () => {
    stubWindow("?via=alice&utm_source=x");
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    const storage = memoryStorage();
    await init({ apiKey: "k", baseUrl: "https://api.test", storage });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.test/sdk/install");
    expect((opts.headers as Record<string, string>).authorization).toBe("Bearer k");
    const body = sentBody(fetchMock);
    expect(body.affiliateCode).toBe("alice");
    expect(body.deviceId).toBe(storage.get(DEVICE_ID_KEY));
    expect(typeof body.firstOpenAt).toBe("number");
    expect(storage.get(PENDING_CODE_KEY)).toBe("alice");
    expect(storage.get(AFFILIATE_ID_KEY)).toBe("aff_1");
    expect(storage.get(ATTRIBUTION_ID_KEY)).toBe("attr_1");
  });

  it("auto-captures ?ct= claim token (takes precedence over a code)", async () => {
    stubWindow("?ct=tok_123&via=alice");
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    await init({ apiKey: "k", baseUrl: "https://api.test", storage: memoryStorage() });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = sentBody(fetchMock);
    expect(body.claimToken).toBe("tok_123");
    expect(body.affiliateCode).toBeUndefined();
  });

  it("does not read the URL when autoCapture is false", async () => {
    stubWindow("?via=alice");
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    await init({
      apiKey: "k",
      baseUrl: "https://api.test",
      autoCapture: false,
      storage: memoryStorage(),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("re-applies a persisted pending code on a later init (signup still attributes)", async () => {
    stubWindow("");
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    const storage = memoryStorage({ [PENDING_CODE_KEY]: "alice" });
    await init({ apiKey: "k", baseUrl: "https://api.test", storage });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentBody(fetchMock).affiliateCode).toBe("alice");
    expect(storage.get(AFFILIATE_ID_KEY)).toBe("aff_1");
  });

  it("does not re-apply the pending code once already attributed", async () => {
    stubWindow("");
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    const storage = memoryStorage({ [PENDING_CODE_KEY]: "alice", [AFFILIATE_ID_KEY]: "aff_1" });
    await init({ apiKey: "k", baseUrl: "https://api.test", storage });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("network failures are silent", () => {
  it("applyCode returns false and keeps the pending code when fetch rejects", async () => {
    stubWindow("");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("offline"))),
    );
    const storage = memoryStorage();
    await init({ apiKey: "k", baseUrl: "https://api.test", storage });
    await expect(applyCode("alice")).resolves.toBe(false);
    expect(storage.get(PENDING_CODE_KEY)).toBe("alice");
    expect(attributedAffiliateId()).toBeNull();
  });

  it("returns false on non-2xx (404 no attributable click)", async () => {
    stubWindow("");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
    );
    await init({ apiKey: "k", baseUrl: "https://api.test", storage: memoryStorage() });
    await expect(attributeToken("tok")).resolves.toBe(false);
    await expect(identify("user_1")).resolves.toBe(false);
  });
});

describe("identify", () => {
  it("posts deviceId + customerUserId to /sdk/identify", async () => {
    stubWindow("");
    const fetchMock = okFetch({ attributionId: "attr_1", customerUserId: "user_1" });
    vi.stubGlobal("fetch", fetchMock);
    const storage = memoryStorage();
    await init({ apiKey: "k", baseUrl: "https://api.test/", storage });
    await expect(identify("user_1")).resolves.toBe(true);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe("https://api.test/sdk/identify");
    const body = sentBody(fetchMock);
    expect(body.customerUserId).toBe("user_1");
    expect(body.deviceId).toBe(storage.get(DEVICE_ID_KEY));
    expect(typeof body.identifiedAt).toBe("number");
  });
});

describe("attributedAffiliateId / reset", () => {
  it("returns the stored affiliate id and reset clears everything", async () => {
    stubWindow("?via=alice");
    vi.stubGlobal("fetch", okFetch());
    const storage = memoryStorage();
    await init({ apiKey: "k", baseUrl: "https://api.test", storage });
    expect(attributedAffiliateId()).toBe("aff_1");
    reset();
    expect(attributedAffiliateId()).toBeNull();
    expect(storage.data.size).toBe(0);
  });
});

describe("SSR", () => {
  it("all calls are no-ops when window is undefined", async () => {
    const fetchMock = okFetch();
    vi.stubGlobal("fetch", fetchMock);
    // no window stub — vitest node environment has no window
    await expect(
      init({ apiKey: "k", baseUrl: "https://api.test", storage: memoryStorage() }),
    ).resolves.toBeUndefined();
    await expect(applyCode("alice")).resolves.toBe(false);
    await expect(identify("u")).resolves.toBe(false);
    expect(attributedAffiliateId()).toBeNull();
    expect(() => reset()).not.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
