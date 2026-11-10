import { defineMachine } from '@/lib/state-machine/machine';

/**
 * `format_notifications.read_at`: a monotone flag. Rows are inserted unread by SQL (format_fire_event_notify and the
 * challenge notify trigger) and marked read once by `markFormatNotificationsRead`, whose UPDATE is guarded with
 * `read_at IS NULL`; the retention cron deletes old rows. Client-safe.
 */
export const formatNotificationReadMachine = defineMachine({
  id: 'format_notification_read',
  title: 'Format notification read',
  storage: 'format_notifications.read_at',
  summary: "A player's format notification, unread until the player marks it read. Nothing marks it unread again.",
  doc: 'docs/format-kit.md',
  states: ['unread', 'read'],
  initial: ['unread'],
  terminal: ['read'],
  actors: ['player'],
  transitions: [
    {
      event: 'mark_read',
      from: ['unread'],
      to: 'read',
      actors: ['player'],
      writers: ['src/app/api/notifications/read/route.ts', 'src/lib/supabase/queries/format-notifications.ts'],
      note: 'The player marks some or all of their own notifications read.',
    },
  ],
});
