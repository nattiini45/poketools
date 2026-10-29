import type { SocialEventType, SocialIntegration } from '@/types/social';

/**
 * Whether a social integration receives an event: an empty `event_filter` means every event. Shared by the sender
 * (`notify.ts`) and by any read that only needs to know WHICH integrations an event would reach (`previewRecipients`,
 * `src/lib/admin/outward-recipients.ts`). Pure: it never sees a credential.
 */
export function matchesEventFilter(integration: Pick<SocialIntegration, 'event_filter'>, eventType: SocialEventType): boolean {
  if (integration.event_filter.length === 0) return true;
  return integration.event_filter.includes(eventType);
}
