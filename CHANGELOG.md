# Changelog

## 0.2.0

**Two calls, and no API URL.**

Breaking:

- `init({ apiKey, baseUrl })` → `start(apiKey)`. The key can be a bare string; the
  production host is compiled in. `baseUrl` → the optional `apiBaseUrl`, which also
  resolves from `data-api-base-url` on a `<script data-api-key>` tag or
  `globalThis.MAA_API_BASE_URL`. A blank override falls through to the default rather
  than becoming a base URL of `""`.

Added:

- `myAppAffiliate` namespace export (and a default export) alongside the named
  functions, so the surface reads the same as every other platform's SDK.
- Automatic SPA capture. The SDK hooks `pushState`/`replaceState`/`popstate`, so a
  creator linking to a deep route is captured whether or not that route was the entry
  page. Disable with `spa: false`.
- `capture()` — re-scan the current URL — and `attribute(url)` — claim from an explicit
  URL, code or claim token.
- `debug` option.

## 0.1.0

- Initial release: `init`, `applyCode`, `attributeToken`, `identify`,
  `attributedAffiliateId`, `reset`.
- Auto-capture of `?via=` / `?ref=` / `?maa_code=` / `?code=` and `?claim_token=` /
  `?ct=` on load, persisted in localStorage and retried on the next init.
- SSR-safe and silent-safe — nothing throws into the host page.
