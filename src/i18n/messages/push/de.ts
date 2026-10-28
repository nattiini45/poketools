import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  alert: {
    turnTitle: 'Dein Pick in {league}',
    turnTitleNoLeague: 'Dein Pick',
    turnBody: 'Du bist am Zug – noch {time}.',
    remindBody: 'Noch {time} für deinen Pick.',
    redraftTitle: 'Redraft veröffentlicht in {league}',
    redraftTitleNoLeague: 'Redraft veröffentlicht',
    redraftBody: 'Die Redraft-Ergebnisse sind da. Schau dir deinen Kader an.',
    duration: {
      // No trailing abbreviation dot ("Std."): the sentences end with a full stop and would read "12 Std..".
      daysHours: '{d} d {h} h',
      days: '{d} d',
      hoursMinutes: '{h} h {m} min',
      hours: '{h} h',
      minutes: '{m} min',
    },
  },
  settings: {
    heading: 'Push-Benachrichtigungen',
    description:
      'Bekomme auf diesem Gerät eine Benachrichtigung, wenn du mit dem Pick dran bist und bevor deine Zeit abläuft, auch wenn PokéTools geschlossen ist.',
    devicesHeading: 'Geräte mit Push-Benachrichtigungen',
    loading: 'Deine Geräte werden geladen …',
    empty: 'Noch kein Gerät hat Push-Benachrichtigungen aktiviert. Aktiviere sie über die Glocke in einem Draft-Raum.',
    thisDevice: 'Dieses Gerät',
    unknownDevice: 'Unbekanntes Gerät',
    added: 'Hinzugefügt am {date}',
    lastDelivery: 'Letzte Benachrichtigung am {date}',
    noDelivery: 'Noch keine Benachrichtigung zugestellt',
    remove: 'Entfernen',
    removeAria: '{device} entfernen',
    removing: 'Wird entfernt …',
    removed: 'Gerät entfernt.',
    loadFailed: 'Deine Geräte konnten nicht geladen werden.',
    removeFailed: 'Das Gerät konnte nicht entfernt werden.',
    notConfigured: 'Push-Benachrichtigungen sind auf dieser Seite nicht eingerichtet.',
    privacy:
      'Für jedes Gerät, das du aktivierst, wird eine Push-Adresse mit deinem Konto gespeichert, bis du das Gerät entfernst oder dein Konto löschst. Die Adresse wird an den Push-Dienst deines Browser-Anbieters gesendet, der die Benachrichtigungen zustellt.',
  },
});
