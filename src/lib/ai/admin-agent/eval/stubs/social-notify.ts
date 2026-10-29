/**
 * `@/lib/social/notify` for the local-stack eval stages: the sender is a recorder (see `discord-notify.ts`). The one other
 * export of the real module, the admin test message, is refused: nothing in a run may post to a provider.
 */
import type { SocialEventPayload } from '@/types/social';
import { record } from './recorders';

export function emitSocialEvent(payload: SocialEventPayload): void {
  record({ channel: 'social', name: payload.event_type });
}

export async function sendSocialTestMessage(): Promise<never> {
  throw new Error('admin-agent eval: the social test message is not available in a run');
}
