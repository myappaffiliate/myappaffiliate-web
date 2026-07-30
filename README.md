# @maa/sdk-web

Browser attribution SDK for MyAppAffiliate — for SaaS websites and web apps.
Zero dependencies, silent-safe (never throws into your app), SSR-safe (all
calls are no-ops on the server).

## Install

```bash
npm install @maa/sdk-web
```

## Usage

```ts
import { init, identify, attributedAffiliateId, reset } from "@maa/sdk-web";

// Call once on page load (e.g. app root, layout effect, or a <script type="module">).
await init({
  apiKey: "sdk_xxx", // SDK-scoped API key from your dashboard
  baseUrl: "https://api.myappaffiliate.com",
  // autoCapture: true (default) — reads ?via= / ?ref= / ?maa_code= / ?code=
  // referral codes and ?claim_token= / ?ct= claim tokens from the URL.
});

// After signup or login, bind your user id so revenue events attribute:
await identify(user.id);

// The affiliate this browser attributed to (persisted locally), or null:
const affiliateId = attributedAffiliateId();

// On logout / account deletion:
reset();
```

### Manual code entry

If you collect a referral code in a form instead of the URL:

```ts
import { applyCode } from "@maa/sdk-web";
await applyCode("alice"); // → true when attribution succeeded
```

## How attribution works

1. A visitor lands on `https://yourapp.com/?via=alice`. `init()` captures the
   code, persists it (`maa_pending_code` in localStorage), and reports an
   install keyed by a stable device id (`maa_device_id`).
2. If that request fails (offline, ad-blocker), the code stays persisted and is
   retried on the next `init()` — a later signup still attributes.
3. When the visitor signs up, call `identify(userId)`. Revenue events from your
   billing provider (e.g. Stripe with `metadata.customer_user_id = userId`)
   then attribute to the affiliate automatically.

## API

| Function | Returns | Notes |
| --- | --- | --- |
| `init(options)` | `Promise<void>` | `{ apiKey, baseUrl, autoCapture?, storage? }` |
| `applyCode(code)` | `Promise<boolean>` | attribute via referral code |
| `attributeToken(token)` | `Promise<boolean>` | redeem a click claim token |
| `identify(userId)` | `Promise<boolean>` | bind your user id |
| `attributedAffiliateId()` | `string \| null` | persisted affiliate id |
| `reset()` | `void` | clear all persisted SDK state |

`storage` accepts any `{ get, set, remove }` implementation if you prefer
cookies or an in-memory store (used by the test suite).
