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
└── notify.ts  # Webhook dispatch/event fan-out
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
- **Test Files**: No dedicated `src/lib/discord/__tests__` files currently
- **Testing Approach**: API route and integration validation

## Related Modules
- [Match Module](./match.md)
- [Tournament Module](./tournament.md)
- [Supabase Module](./supabase.md)
