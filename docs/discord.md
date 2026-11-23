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
├── webhook-view.ts  # Masked webhook shape the admin API returns
├── phase-webhook-view.ts  # Masked native phase webhook projection
├── draft-embeds.ts  # Discord embeds of the draft tool
└── matchers.ts  # Which webhook receives an event, shared by the sender and the admin preview
```

## Core Functions/Classes

### Native phase webhook storage (dormant)

`phase-discord-webhooks.ts` keeps phase-owned URLs, filters and options in their own table. Its resolver reads the actual phase's parent and combines enabled phase hooks with paged global/league hooks only; it never treats a phase id as a tournament id. Updates/deletes are scoped to the captured phase and configuration version. `toPhaseWebhookView` explicitly copies the admin-visible fields and a masked URL hint, never the URL. Existing routes/dispatch retain their legacy defaults; these new storage adapters alone send no event and add no native-table read to a legacy request.

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
- Posts a fixed embed (`discord.testEmbed.*` in the `integrations` catalog) in the webhook's forced language, or the admin's own language when the webhook follows the league. The URL is re-validated against the Discord-only schema (the same check runs before every event post), redirects are not followed (a 3xx counts as unreachable), the request times out after 8 seconds, and `allowed_mentions` is empty. A disabled webhook can still be tested.
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

## Dormant native phase notifications

`emitPhaseDiscordEvent(payload): void` in `src/lib/discord/notify.ts` is an explicit, fire-and-forget entry point. No route or finalizer is bound to it yet. The legacy `emitDiscordEvent` contract and tournament resolution remain unchanged.

`PhaseDiscordEventPayload` (`src/types/phase-events.ts`) is a versioned discriminated union:

```typescript
{
  version: 1,
  owner: { kind: 'phase', phase_id: phase.id, season_id: phase.season_id },
  event_type: 'match_confirmed',
  data: {
    kind: 'match_confirmed', phase_name: phase.name,
    player_1_name: 'Trainer A', player_2_name: 'Trainer B',
    winner_name: 'Trainer A', game_score: '2-1',
  },
}
```

The data union supports match submission/confirmation/dispute, round generation/completion, achievements, streak milestones/breaks, rating milestones, round recaps/forecasts, and `phase_started` / `phase_completed`. Status data uses `kind: 'phase_status'` and a matching `new_status: 'active'` / `'completed'`. Other fields retain their legacy event-specific meaning, but `phase_name` replaces the display name and report data carries `phase_url`, never `tournament_name`, `tournament_url` or an invented tournament id. League/draft events stay on their existing league-owned path.

The emitter checks the owner against the live phase, then calls `resolvePhaseWebhooks(phase.id)`. That resolver derives the real parent league and unions enabled phase targets with inherited global/league targets. A missing phase or mismatched supplied league aborts notification delivery without throwing to the primary writer. Locale resolution receives only the verified `seasonId`; no phase id enters a tournament resolver. Each webhook still chooses league/English/German independently.

Stored event-filter values remain compatible: native `phase_started` and `phase_completed` match existing `tournament_started` and `tournament_completed` subscriptions respectively; all other filter values are unchanged. `notificationFilterType` is shared with social dispatch. Achievement/streak/rating switches, spoiler/detail/replay options and optional match-card attachments use the same delivery seam as legacy notifications. Cards are generated once per requested language; a card failure still sends text. Rendering consumes phase data directly through the pure `buildNotificationEmbed`, without a fabricated ownership row. Existing translated template placeholder names are display labels only; status copy explicitly says phase in both languages.

Native dispatch tests mock phase reads, recipient resolution, outbound requests and card generation. They perform no database, Storage, image or provider requests.

## Testing

- **Test Files — `src/lib/discord/`**: `src/lib/discord/__tests__/` (11 test files): `draft-embeds.test.ts`, `embeds-rating-milestone.test.ts`, `embeds.test.ts`, `fonts.test.ts`, `helpers.test.ts`, `match-card-image.test.tsx`, `notify.test.ts`, `phase-embeds.test.ts`, `phase-notify.test.ts`, `webhook-test.test.ts`, `webhook-view.test.ts`.
- **Test Files**: `src/lib/discord/__tests__/webhook-test.test.ts`, `webhook-view.test.ts`; the route tests under `src/app/api/discord-webhooks/**/__tests__`; `src/components/discord/__tests__/webhook-test-client.test.ts`
- **Testing Approach**: API route and integration validation; the test post mocks global `fetch`

## Related Modules
- [Match Module](./match.md)
- [Tournament Module](./tournament.md)
- [Supabase Module](./supabase.md)
