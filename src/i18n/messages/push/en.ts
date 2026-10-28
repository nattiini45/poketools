/**
 * Web Push (docs/push.md). Two audiences share the namespace:
 * - `alert`: the notification text the SERVER builds for a subscription's stored language
 *   (`src/lib/push/payload.ts`, `createTranslator(pushMessages, locale)`), never the viewer's cookie;
 * - `settings`: the "Push alerts" card on the settings page (`PushDevicesForm`).
 * The draft room's own control texts live in `draft/screen` (`notify.*`).
 */
export default {
  alert: {
    turnTitle: 'Your pick in {league}',
    /** Used when the league has no name. */
    turnTitleNoLeague: 'Your pick',
    turnBody: 'You are on the clock – {time} left.',
    remindBody: '{time} left for your pick.',
    redraftTitle: 'Redraft published in {league}',
    redraftTitleNoLeague: 'Redraft published',
    redraftBody: 'The redraft results are out. Check your roster.',
    duration: {
      daysHours: '{d} d {h} h',
      days: '{d} d',
      hoursMinutes: '{h} h {m} min',
      hours: '{h} h',
      minutes: '{m} min',
    },
  },
  settings: {
    heading: 'Push alerts',
    description:
      'Get a notification on this device when it is your turn to pick and before your time runs out, even when PokéTools is closed.',
    devicesHeading: 'Devices with push alerts',
    loading: 'Loading your devices…',
    empty: 'No device has push alerts turned on yet. Turn them on from the bell in a draft room.',
    thisDevice: 'This device',
    unknownDevice: 'Unknown device',
    added: 'Added {date}',
    lastDelivery: 'Last alert {date}',
    noDelivery: 'No alert delivered yet',
    remove: 'Remove',
    removeAria: 'Remove {device}',
    removing: 'Removing…',
    removed: 'Device removed.',
    loadFailed: 'Your devices could not be loaded.',
    removeFailed: 'The device could not be removed.',
    notConfigured: 'Push alerts are not set up on this site.',
    privacy:
      'Each device you turn on stores one push address with your account until you remove it or delete your account. The address is sent to your browser vendor’s push service, which delivers the notifications.',
  },
} as const;
