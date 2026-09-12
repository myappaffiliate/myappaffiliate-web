# @myappaffiliate/sdk-web

Browser attribution SDK for MyAppAffiliate — for web products and SaaS frontends.
Zero dependencies, silent-safe (never throws into your page), SSR-safe (all calls are
no-ops on the server).

**The whole integration is two calls.** You never type an API URL: the production host
is compiled in.

## Install

**Script tag** — no build tooling, no inline JavaScript, captures on load:

```html
<script
  src="https://cdn.jsdelivr.net/npm/@myappaffiliate/sdk-web@0/dist/sdk.js"
  data-api-key="pk_live_…"
  async
></script>
```

That is the whole install. The tag starts the SDK itself and puts the same
surface on `window.myAppAffiliate`, so `identify` at signup is one line of
inline script. `@0` tracks the latest 0.x; pin `@0.2.0` for a frozen bundle.

**npm** — for app frontends:

```bash
npm install @myappaffiliate/sdk-web
```

## 1. Start it

```ts
import { myAppAffiliate } from "@myappaffiliate/sdk-web";

myAppAffiliate.start("pk_live_…");
```

That is the entire call — no host, no options. Put it in your app shell, root layout,
or a `<script type="module">` on the landing page. It is safe to run during SSR, so
Next.js / Remix / SvelteKit need no `typeof window` guard.

`start` captures the referral from the current URL, and keeps capturing on client-side
route changes:

- `?via=LUMI` (also `?ref=`, `?maa_code=`, `?code=`) → referral-code attribution
- `?claim_token=<uuid>` (or `?ct=`) → click-claim attribution from a branded link

The winner is persisted in `localStorage` (`maa_pending_code`, keyed by a stable
`maa_device_id`), so the referral survives navigation, a closed tab, and the days
between landing and signup. If the network call fails, the code stays persisted and is
retried on the next `start` — a later signup still attributes.

**SPAs need nothing extra.** The SDK hooks `pushState`/`replaceState`/`popstate`, so a
creator linking to a deep route (`/pricing?via=LUMI`) is captured whether or not that
route was the entry page.

## 2. Identify the user at signup

```ts
await myAppAffiliate.identify(user.id);
```

The id must be the **same string your billing provider reports back to us**: Stripe's
`metadata.customer_user_id` (or `client_reference_id`, or the Stripe customer id),
Paddle's custom data. That is the only join key there is — if the two differ,
everything looks healthy and no commission is ever created.

That's it. There is no third step.

## Optional

```ts
myAppAffiliate.applyCode("LUMI");             // a referral-code field at checkout
myAppAffiliate.capture();                     // re-scan the URL manually
myAppAffiliate.attribute("https://…?via=…");  // claim from an explicit URL
myAppAffiliate.attributedAffiliateId();       // string | null, for your own UI
myAppAffiliate.reset();                       // on logout / account deletion
```

Full options — reach for these only when you have a reason to:

```ts
myAppAffiliate.start({
  apiKey: "pk_live_…",
  apiBaseUrl: "https://staging.example.com",  // staging / self-hosted
  storage: myCookieStore,                     // any { get, set, remove }
  autoCapture: true,                          // default
  spa: true,                                  // default — capture on route change
  debug: false,
});
```

`apiBaseUrl` also resolves from `data-api-base-url` on a `<script data-api-key>` tag or
`globalThis.MAA_API_BASE_URL`, so an ops-set value never has to enter your source.
A blank value falls through to the default rather than breaking every request.

Every function is also a named export (`import { start, identify } from "@myappaffiliate/sdk-web"`)
if you prefer that to the namespace.

## API

| Function | Returns | Notes |
| --- | --- | --- |
| `start(apiKey \| options)` | `Promise<void>` | a key string, or `{ apiKey, apiBaseUrl?, autoCapture?, spa?, storage?, debug? }` |
| `identify(userId)` | `Promise<boolean>` | bind your user id |
| `capture()` | `Promise<boolean>` | re-scan the current URL |
| `attribute(url)` | `Promise<boolean>` | claim a referral from an explicit URL |
| `applyCode(code)` | `Promise<boolean>` | attribute via referral code |
| `attributeToken(token)` | `Promise<boolean>` | redeem a click claim token |
| `attributedAffiliateId()` | `string \| null` | persisted affiliate id |
| `reset()` | `void` | clear all persisted SDK state |

No cookies, no fingerprinting, first-party only. Network failures resolve to
`false`/`null` — never an uncaught error on your page.
