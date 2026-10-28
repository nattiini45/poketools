import type { DiscordWebhook } from '@/types/discord';

/**
 * The two rules that decide whether a webhook receives an event, shared by the sender (`notify.ts`) and by any read that
 * only needs to know WHICH webhooks an event would reach (`previewRecipients`, `src/lib/admin/outward-recipients.ts`), so
 * the preview and the post cannot drift apart. Pure: no database, no network.
 */

/** An empty `event_filter` means every event. */
export function matchesFilter(webhook: Pick<DiscordWebhook, 'event_filter'>, eventType: string): boolean {
  if (webhook.event_filter.length === 0) return true;
  return webhook.event_filter.includes(eventType as DiscordWebhook['event_filter'][number]);
}

/** The per-webhook switches for achievements, streaks and rating milestones; every other payload kind passes. */
export function matchesFormatOptions(webhook: Pick<DiscordWebhook, 'format_options'>, payload: { data: { kind: string } }): boolean {
  if (payload.data.kind === 'achievement_unlocked') {
    return webhook.format_options.show_achievements;
  }
  if (payload.data.kind === 'streak_milestone' || payload.data.kind === 'streak_broken') {
    return webhook.format_options.show_streaks;
  }
  if (payload.data.kind === 'rating_milestone') {
    return webhook.format_options.show_ratings;
  }
  return true;
}
