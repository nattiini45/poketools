# Web Push (draft turn alerts)

> Module doc for `src/lib/push/`, `src/app/api/push/subscriptions/`, `src/lib/supabase/queries/push-subscriptions.ts`, the push handlers in `public/sw.js`, the draft room's bell (`src/components/draft-tool/feedback/NotifyToggle.tsx`, `hooks/use-turn-watch.ts`) and the settings card (`src/components/player/PushDevicesCard.tsx`).

Web Push puts a player's turn alerts on their devices even when no PokéTools page is open. The server sends them; the browser's push service delivers them to a service worker, which shows the notification.

## What is sent, and when

Pushes ride the draft's existing notification claims. `draft_claim_notifications` claims every due event exactly once in SQL (claim markers on the slot or pool, `FOR UPDATE SKIP LOCKED`); `dispatchDraftNotifications` (`src/lib/draft/notify.ts`) turns the claims into Discord events and then calls `pushDraftClaims` (`src/lib/push/draft-alerts.ts`) with the same claims. There is no second scheduler, so a push is exactly as often as a Discord ping, and quiet hours, pauses and slot changes are already decided by the claim.

| Claim | Push recipients | TTL | Urgency | Text (EN) |
|---|---|---|---|---|
| `turn_started` (live and slow) | the slot's player | until the deadline, 60 s to 24 h | high | "Your pick in {league}" / "You are on the clock – {time} left." (`time` is the slot's full pick time) |
| `turn_reminder` 8h / 4h / 1h (slow only) | the slot's player | until the deadline, 60 s to 24 h | high | "Your pick in {league}" / "{threshold} left for your pick." |
| `redraft_published` | every participant of the pool | 24 h | normal | "Redraft published in {league}" / "The redraft results are out. Check your roster." |
| `admin_alert` | nobody (admins are pinged on Discord) | - | - | - |

- The dispatch runs inside `after()` (pick, redraft publish, `scheduleDraftNotifications`) or the `draft-ticks` cron. It awaits the sends so they finish before the function is frozen; `pushDraftClaims` and the sender never throw into the caller.
- The payload is small JSON `{ kind, title, body, url, tag }`: a league name, a duration and a same-origin path. No player id, token or pick data. It is built on the server in the language stored with each subscription (`push_subscriptions.locale`), from the `push` message namespace (`alert.*`), never from the viewer's cookie. `tag` is `draft-<poolId>`; the service worker shows with `renotify`, so a newer alert for the same pool replaces the older one in the tray and alerts again. The `Topic` header is a 32 character hash of the pool for the same reason on a device that was offline.
- A visible draft-room tab still shows its in-app state (banner, title, toasts). The system notification is sent regardless: browsers require every push to show something (Safari revokes subscriptions that stay silent), so there is no "skip when the tab is open" rule.
- The hidden-tab my-turn watch (`GET /api/drafts/[id]/my-turn` every 60 s, `use-turn-watch.ts`, the D37 exception in AGENTS.md) no longer raises notifications. It stays because the request lets the server resolve a due timeout, which claims and sends the next slot's alerts.

## Configuration

| Variable | Where | Meaning |
|---|---|---|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | build time (client bundle) and server | the VAPID public key (base64url, 65 bytes) |
| `VAPID_PRIVATE_KEY` | server secret | the matching private key (base64url, 32 bytes) |
| `VAPID_SUBJECT` | server | a contact the push services can reach: `mailto:name@example.com` or an `https:` URL |

Make a key pair once per deployment with `npx web-push generate-vapid-keys` and keep the private key out of the repository. Changing the pair invalidates every stored subscription (their push services answer 403/410; the sender then drops them).

`src/lib/push/config.ts` (`readPushConfig`) validates all three: the key lengths, that the private key belongs to the public one, and the subject form. Anything missing or invalid means push is **disabled**: the server sends nothing and reads nothing, `POST /api/push/subscriptions` answers `503 push_disabled`, `GET` reports `enabled: false`, and one warning per process names the offending variables (never a value). The UI hides the bell and the settings card when the build has no public key, and the bell hides itself for good once the server answers `push_disabled`. A deployment without keys behaves exactly as before.

The service worker is registered whenever push is configured, even with `NEXT_PUBLIC_PWA_ENABLED=false`: it is then registered as `/sw.js?mode=push`, which handles push only and caches and intercepts nothing (it also removes shell caches an earlier PWA-enabled build left). With the PWA flag on, the worker is the full offline shell plus the push handlers. `src/lib/push/client.ts` (`swScriptUrl`) is the single place that picks the URL; `PwaRegistrar` and the bell both use it.

## Platforms

| Platform | How push works |
|---|---|
| Chrome, Edge, Brave, Opera on Windows, macOS, Linux, ChromeOS | works in the browser |
| Firefox on Windows, macOS, Linux | works in the browser |
| Safari on macOS | works in the browser |
| Chrome and other browsers on Android | works in the browser tab and in the installed PWA |
| Safari on iOS and iPadOS 16.4 or later | **only when PokéTools is added to the Home Screen** and opened from there. In a browser tab Apple exposes no push API, so the bell shows "Add PokéTools to your Home Screen" with the steps. Earlier versions are unsupported and the bell is hidden |

Permission is requested only when the player clicks the bell (`Notification.requestPermission()` inside `enablePush`), never on page load. A blocked permission shows "Blocked in browser settings" with how to unblock it. The hint of the install and blocked states is text, not a tooltip: touch screens have no hover.

## The bell, the device list and the states

The draft room's bell (clock bar, and the players sheet with its note) is "Push alerts on this device": it subscribes or unsubscribes THIS browser (`usePushAlerts`, `src/lib/push/client.ts`). It is per device, not per pool.

| State | Control |
|---|---|
| unsupported, or the server is not configured | hidden |
| `install-required` (iPhone/iPad in a tab) | "Add PokéTools to your Home Screen"; a click opens the hint |
| `default` | "Turn on push alerts"; a click asks for permission, subscribes and registers the device |
| `granted`, subscribed | "Push alerts on for this device" (pressed); a click removes the device |
| `granted`, not subscribed | "Push alerts off for this device" |
| `denied` | "Blocked in browser settings"; a click opens the hint |
| busy | disabled, "Working…" |
| failed | an alert under the control with the catalogued error text; retryable |

A subscribe the server refuses (rejected push service, rate limit, disabled) drops the browser subscription again, so the two never disagree. An unsubscribe the server cannot complete keeps the browser subscription for the same reason (a 404 counts as done). The page language is re-posted when it changed since the last sync (`localStorage['push:locale:v1']`), so the alerts follow the UI language. Keys left behind by the old local alerts (`draft:notify:*`, `draft:notified:*`) are removed once per visit (`clearLegacyNotifyKeys`).

The settings page (`/dashboard/settings`) has a "Push alerts" card listing the player's devices (label such as "Chrome on Android", added date, last alert), marking this browser, with a remove button per row and the privacy note. Turning a device on happens from the bell.

## API

`/api/push/subscriptions`, every method behind the live `requirePlayer()` guard and acting on the guard's player, never an id from the body.

| Method | Body | Answer |
|---|---|---|
| `GET` | - | `{ enabled, devices: [{ id, label, createdAt, lastSuccessAt, fingerprint }] }`, `no-store`. Never keys; no endpoint either (the fingerprint, 16 hex chars of sha256(endpoint), lets a browser recognise its own row) |
| `POST` | `{ endpoint, keys: { p256dh, auth }, locale?, replaces? }` | `{ subscribed, fingerprint, dropped }`. Upserts by endpoint (an endpoint stored for another player is re-bound to the caller); `replaces` removes the caller's previous endpoint (a `pushsubscriptionchange` re-subscribe) |
| `DELETE` | `{ endpoint }` or `{ id }` | `{ removed: true }`; `404 push_device_not_found` when the caller owns no such row |

Checks, in order: auth, same-origin (`Origin` must match when present), `POST` needs a valid server configuration, a rate limit of 30 per player per 10 minutes on `POST` and `DELETE`, body size (8 KB), the zod schema (`src/lib/push/validation.ts`: strict, `p256dh` an uncompressed P-256 point, `auth` 16 bytes, both base64url), and for `POST` the endpoint allow-list. Error codes (EN + DE in `errors/players`): `push_disabled` (503), `push_cross_origin` (403), `push_subscription_invalid` (400), `push_endpoint_not_allowed` (400), `push_device_not_found` (404), `push_list_failed`, `push_subscribe_failed`, `push_unsubscribe_failed` (500), and `rate_limited` (429).

### Endpoint allow-list

The endpoint is a URL the server later requests, so an unchecked one would be a server-side request forgery primitive. `src/lib/push/endpoint.ts` accepts only `https` URLs without credentials, port or fragment, whose hostname is exactly `fcm.googleapis.com`, `jmt17.google.com` or `web.push.apple.com`, or a subdomain of `push.services.mozilla.com`, `notify.windows.com` or `push.apple.com` (dot boundary; look-alikes fail). If a browser vendor adds a host, a legitimate subscribe fails with `push_endpoint_not_allowed` and the log line says an unlisted push service was refused: extend the lists and the test in `src/lib/push/__tests__/endpoint.test.ts`.

## Storage and delivery bookkeeping

Table `push_subscriptions` (migration `20261028120000_push_subscriptions.sql`): `id`, `player_id` (cascade on player delete), `endpoint` (unique, https, at most 1024 characters), `p256dh`, `auth`, `locale` (`en`/`de`), `user_agent_label` (derived on the server, for example "Chrome on Android"; the raw User-Agent is never stored), `created_at`, `last_success_at`, `failure_count`. RLS on, no policies, privileges for `service_role` only. A player keeps at most 10 devices; adding an 11th drops the oldest (`upsertPushSubscription`). The table references only `players`, so the league recycle bin inventory needs no entry.

The sender (`src/lib/push/send.ts`) reads the devices of all recipients with one query and fans out with at most 8 requests in flight (10 s socket timeout). Per device:

- success: `last_success_at` is stamped and the failure streak cleared;
- 404 or 410: the push service says the endpoint is gone; the row is deleted;
- any other failure (4xx, 5xx, network, timeout): the streak grows, and the row is deleted when it reaches 5 consecutive failures.

Logs name the push service host and the status code, never an endpoint path, key or payload.

## Service worker

`public/sw.js` (`CACHE_VERSION` v2):

- `push`: shows the notification (`title`, `body`, `tag`, `renotify`, icon) from the payload, and always shows something, also for a missing or malformed payload. A payload URL is reduced to a same-origin path; anything else opens `/`.
- `notificationclick`: closes the notification, focuses an open PokéTools window already on that page, else navigates another PokéTools window there, else opens a window.
- `pushsubscriptionchange`: subscribes again if the browser gave no new subscription and POSTs it with the old endpoint as `replaces`.
- The shell caching (install, activate, fetch) is unchanged, and switched off in `?mode=push`.

There is no monochrome badge asset yet, so notifications carry only the icon (`/pwa/icon-192.png`).

## Privacy

Each device a player turns on stores one push endpoint and its two public key parts with the account until the player removes the device, the push service reports it gone, five sends in a row fail, or the account is deleted. The endpoint is sent to the browser vendor's push service (Google, Mozilla, Microsoft or Apple) with every message, and the vendor's service delivers the encrypted payload; PokéTools stores no User-Agent string and no other device data. The settings card states this in the player's language (`push` namespace, `settings.privacy`).

## Tests

- `src/lib/push/__tests__/`: the endpoint allow-list, the request schemas, the VAPID configuration, the payload text per language, the sender (410 deletes, failure counting and the limit, concurrency, TTL clamp, nothing sent when disabled), the claim to push mapping, the service worker handlers (the real `public/sw.js` run in a `vm` context), the browser layer (`client.ts` against faked browser APIs), the user-agent labels and the migration text.
- `src/lib/draft/__tests__/notify-push.test.ts`: the dispatch hands the same claims to the push hook, awaited, and a push failure never breaks it. The existing Discord tests are unchanged.
- `src/app/api/push/subscriptions/__tests__/route.test.ts`: auth, ownership, rate limit, bad bodies, allow-list, cross-origin, disabled.
- `src/lib/supabase/queries/__tests__/push-subscriptions.test.ts`: the query module against a recording fake client.
- `src/components/draft-tool/__tests__/{notify-toggle,push-alerts-hook}.test.tsx`, `src/components/player/__tests__/PushDevicesCard.test.tsx`, `src/components/shared/__tests__/PwaRegistrar.test.tsx`: the UI states (including iOS not installed and denied), in English and German.

Real delivery to a physical device needs a deployment with a key pair and a secure origin; nothing in the suite contacts a push service.
