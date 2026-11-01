# Social Module

## Overview
The Social module handles event fan-out to X, Threads, and Bluesky with provider-specific publishing and formatting.

## File Structure
```
src/lib/social/
├── bluesky-host.ts  # Pure service_url host check (allowlist, rejection reasons)
├── bluesky-service.ts  # Env-backed service_url resolver used by the provider and the routes
├── crypto.ts  # Credential encryption/decryption helpers
├── format.ts  # Event -> social post formatter
├── image-fetch.ts  # Remote image fetching helpers
├── notify.ts  # Event fan-out orchestration
├── validation.ts  # Social integration input validation
└── providers/
    ├── bluesky.ts  # Bluesky publishing
    ├── index.ts  # Provider dispatcher
    ├── threads.ts  # Threads publishing
    └── x.ts  # X publishing
```

## Core Functions/Classes

### Event Fan-Out
- **File**: `notify.ts`
- **Purpose**: Fire-and-forget publish for configured integrations
- **Key Methods**: `emitSocialEvent()`, `sendSocialTestMessage()`

### Provider Dispatcher
- **File**: `providers/index.ts`
- **Purpose**: Route a publish call to the provider implementation
- **Key Methods**: `publishToProvider()`

### Formatter
- **File**: `format.ts`
- **Purpose**: Build provider-safe social post text
- **Key Methods**: `formatSocialPost()`

## Outbound requests
- Every request to X, Threads, Bluesky and a Discord webhook goes through `outboundFetch` (`src/lib/outbound-fetch.ts`): no redirect is followed (a 3xx fails the request, so a bearer token or app password cannot be bounced to another host) and a deadline applies (8 s for Discord, 10 s for the social providers).
- Bluesky `credentials.service_url` is not a free-form URL, because the provider sends the account's app password to it. It must be an `https` origin (no userinfo, explicit port (including `:443` and an empty `host:`, read from the raw URL because the parser drops them), path, IP literal, `localhost`, `*.local` or `*.internal`) whose host is `bsky.social` or listed in `BLUESKY_SERVICE_HOST_ALLOWLIST` (comma-separated, env-only). An omitted or blank value means `bsky.social`. The check runs at write time (400 `validation_failed`, issue `credentials.service_url: not allowed (<reason>)`; no outbound request) and again at send time (`BlueskyServiceUrlError`, a `UserFacingError`), so a row stored before the rule cannot be used. At the test route (`POST /api/social-integrations/[id]/test`) that answers 422 `social_bluesky_service_url_rejected` with the rule's slug as `reason`; on the live event path it is logged as `failure=invalid_target (<reason>)`.
- A Discord webhook URL is re-checked against `discordWebhookUrlSchema` (`https://discord.com/api/webhooks/<id>/<token>`, token `[\w-]+`) before each post; a stored row that fails is skipped.
- Logs carry the webhook id and the error class, never the webhook URL, a handle, a password or a token. An upstream response body is never read into a thrown message or a log line (a provider or a self-hosted PDS can echo the handle, app password or webhook URL it was sent): a failed response becomes an `OutboundHttpError` with the provider, step and HTTP status only, and a rejected Discord post logs the status only.
- The live event path (`emitSocialEvent`) logs every rejected post as `[Social] Post failed: integration=<id> provider=<p> event=<type> failure=<class>`. `<class>` is `invalid_target (<reason>)`, `http_error ([<Provider>] <step> failed: <status>)`, or the error's class name (`TimeoutError`, `TypeError`); other messages are not logged because they can name a host or carry request text.
- Out of scope: the `after()` emitters that call `emitDiscordEvent` / `emitSocialEvent` (their lifetime is a separate concern).

## Data Flows
- **Input**: Social event payload + provider credentials/options
- **Processing**:
  1. Resolve scoped integrations
  2. Decrypt credentials and format content
  3. Publish to each target provider
- **Output**: Published social posts (errors are logged and swallowed)

## Dependencies
- **External Libraries**: Provider HTTP APIs
- **Internal Modules**:
  - [Match Module](./match.md)
  - [Tournament Module](./tournament.md)
  - [Supabase Module](./supabase.md)

## API Routes
- `/api/social-integrations`
- `/api/social-integrations/[id]`
- `/api/social-integrations/[id]/test`

## Usage Examples

```typescript
import { emitSocialEvent } from '@/lib/social/notify';

void emitSocialEvent(payload);
```

## Testing
- **Test Files**:
  - `src/app/api/social-integrations/__tests__/route.test.ts`
  - `src/app/api/social-integrations/[id]/__tests__/route.test.ts`
- **Testing Approach**: API route coverage with mocked provider calls

## Related Modules
- [Match Module](./match.md)
- [Tournament Module](./tournament.md)
- [Supabase Module](./supabase.md)
