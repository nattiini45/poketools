import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  kind: { label: 'Wettbewerbsart', league: 'Ligen', tournament: 'Turniere' },
  view: { label: 'Anzeigen', active: 'Aktiv', archived: 'Archiviert', trash: 'Papierkorb' },
  new: { league: 'Neue Liga', tournament: 'Neues Turnier' },
  search: {
    label: 'Wettbewerbe durchsuchen',
    placeholder: 'Name, Format oder Regelwerk',
    clear: 'Suche leeren',
  },
  count: {
    league: { one: '{count} Liga', other: '{count} Ligen' },
    tournament: { one: '{count} Turnier', other: '{count} Turniere' },
    filtered: '{shown} von {total}',
  },
  caption: { league: 'Ligen', tournament: 'Turniere' },
  columns: {
    name: 'Name',
    format: 'Format',
    status: 'Status',
    players: 'Spieler',
    dates: 'Zeitraum',
    nextAction: 'Nächster Schritt',
  },
  row: {
    test: 'Test',
    archived: 'Archiviert',
  },
  dates: {
    range: '{start} – {end}',
    from: 'Ab {date}',
    until: 'Bis {date}',
    created: 'Erstellt am {date}',
    none: 'Nicht festgelegt',
  },
  action: {
    setup: 'Einrichten',
    manage: 'Verwalten',
    review: 'Ansehen',
    open: 'Öffnen',
  },
  actionLabel: '{action}: {name}',
  empty: {
    league: {
      active: { title: 'Noch keine Ligen', hint: 'Lege die erste Liga an, um eine Saison zu starten.' },
      archived: { title: 'Keine archivierten Ligen', hint: 'Archivierst du eine beendete Liga, landet sie hier.' },
    },
    tournament: {
      active: { title: 'Noch keine Turniere', hint: 'Lege ein eigenständiges Turnier für einen einmaligen Turnierbaum an.' },
      archived: { title: 'Keine archivierten Turniere', hint: 'Archivierst du ein beendetes Turnier, landet es hier.' },
    },
    noMatches: {
      title: 'Nichts passt zu „{query}“',
      hint: 'Prüfe die Schreibweise oder leere die Suche.',
    },
  },
});
