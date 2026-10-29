/**
 * `@/lib/discord/notify` for the local-stack eval stages: the sender is a recorder. The real one resolves the league's
 * webhooks and posts an embed to each; this one records the event type and sends nothing, so a case can assert that exactly
 * `round_generated` and `tournament_started` fired, and none before the approve click.
 */
import type { DiscordEventPayload } from '@/types/discord';
import { record } from './recorders';

export function emitDiscordEvent(payload: DiscordEventPayload): void {
  record({ channel: 'discord', name: payload.event_type });
}
