# Discord Module

## Overview
The Discord module handles webhook fan-out, rich embed construction, and optional match-card image generation. Full Discord bot/DM support is deferred; current scope is webhook-based event fan-out with event hooks for match proposals and auto-confirm available for future bot work.

## File Structure
```
src/lib/discord/
├── embeds.ts  # Event -> embed/content formatting
├── fonts.ts  # Font loading for image rendering
├── helpers.ts  # Shared Discord formatting helpers
├── match-card-image.tsx  # Match card PNG renderer
├── notify.ts  # Webhook dispatch/event fan-out
├── webhook-test.ts  # Server-side test post for one stored webhook
└── webhook-view.ts  # Masked webhook shape the admin API returns
```

## Core Functions/Classes

### Notification Fan-Out
- **File**: `notify.ts`
- **Purpose**: Fire-and-forget event emission to resolved webhooks
- **Key Methods**: `emitDiscordEvent()`

### Embed Builder
- **File**: `embeds.ts`
- **Purpose**: Build typed Discord payloads per event kind
- **Key Methods**: `buildEmbed()`

### Webhook Test and Masked View
- **Files**: `webhook-test.ts`, `webhook-view.ts`
- **Purpose**: The admin UI's Test button posts from the server, and the webhook URL stays out of the browser
- **Key Methods**: `sendWebhookTestMessage()`, `toWebhookView()`, `webhookUrlHint()`

### Match Card Renderer
- **File**: `match-card-image.tsx`
- **Purpose**: Render match card images for attachments
- **Key Methods**: `generateMatchCardImage()`

## Data Flows
- **Input**: Domain event payloads (match, round, draft, achievements)
- **Processing**:
  1. Resolve webhooks by scope
  2. Build embed/content payload
  3. Optionally attach generated match card image
  4. POST webhook requests
- **Output**: Discord channel notifications

## Dependencies
- **External Libraries**: Next OG `ImageResponse` pipeline + image/font tooling
- **Internal Modules**:
  - [Match Module](./match.md)
  - [Tournament Module](./tournament.md)
  - [Gamification Module](./gamification.md)
  - [Supabase Module](./supabase.md)

## API Routes
- `/api/discord-webhooks`
- `/api/discord-webhooks/[id]`
- `/api/discord-webhooks/[id]/test`

All three are site-admin only.

### Masked webhook responses
A webhook URL is a secret: anyone holding it can post to the channel. It is write-only from the admin UI. `POST /api/discord-webhooks` and `PATCH /api/discord-webhooks/[id]` still accept `webhook_url` (validated by `discordWebhookUrlSchema`) and store it, but no response contains it. `GET /api/discord-webhooks`, `POST` (201) and `PATCH` answer with `DiscordWebhookView`: every webhook field except `webhook_url`, plus `webhook_url_hint` (an ellipsis and the last four characters of the URL). The masking happens in the route layer (`toWebhookView`); the query module (`resolveWebhooks`, `listAllWebhooks`, `getWebhookById`) keeps returning the full `DiscordWebhook`, because dispatch in `notify.ts` reads the URL server-side.

### Test post: `POST /api/discord-webhooks/[id]/test`
- Site admin only; no request body. The server loads the stored URL by id, so the browser never sends or receives it.
- Rate limited to 10 requests per 60 seconds per admin (bucket `discord-webhook-test`), checked before the database read (429 via `rateLimitedResponse`).
- Posts a fixed embed (`discord.testEmbed.*` in the `integrations` catalog) in the webhook's forced language, or the admin's own language when the webhook follows the league. The URL is re-validated against the Discord-only schema, redirects are not followed, the request times out after 8 seconds, and `allowed_mentions` is empty. A disabled webhook can still be tested.
- Every attempt is audited as `discord_webhook.test` (`ok`, plus `status` or `kind`); the URL is never logged or returned.
- Responses: 200 `{ status }`; 404 `webhook_not_found`; 404 `INVALID_WEBHOOK_ID` for a malformed id; 429 `rate_limited`; 502 `discord_webhook_test_rejected` (param `status`, Discord's HTTP status); 502 `discord_webhook_test_unreachable` (timeout, DNS or network failure); 422 `discord_webhook_url_invalid` (the stored URL fails validation). Anything else goes through `safeErrorResponse`.

## Deferred Bot Scope
- No slash commands or DMs are implemented in this pass.
- Future bot work should define explicit env vars, interaction routes, permission checks, and audit behavior before implementation.
- Match proposal and auto-confirm events should continue to be emitted through existing webhook/event abstractions so a bot can subscribe later.

## Usage Examples

```typescript
import { emitDiscordEvent } from '@/lib/discord/notify';

void emitDiscordEvent({
  event_type: 'match_confirmed',
  tournament_id: tournamentId,
  season_id: seasonId,
  data: payload,
});
```

## Testing
- **Test Files**: `src/lib/discord/__tests__/webhook-test.test.ts`, `webhook-view.test.ts`; the route tests under `src/app/api/discord-webhooks/**/__tests__`; `src/components/discord/__tests__/webhook-test-client.test.ts`
- **Testing Approach**: API route and integration validation; the test post mocks global `fetch`

## Related Modules
- [Match Module](./match.md)
- [Tournament Module](./tournament.md)
- [Supabase Module](./supabase.md)
