import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  // Pagination wording copied from the reviewed hub copy (`src/lib/league-hub/copy.ts`).
  table: {
    showing: '{start}–{end} von {total}',
    rows: 'Zeilen',
    rowsPerPage: 'Zeilen pro Seite',
    pagination: 'Seitennavigation',
    previousPage: 'Vorherige Seite',
    nextPage: 'Nächste Seite',
    page: 'Seite {page}',
  },
  combobox: {
    clear: 'Leeren',
    searching: 'Suche läuft …',
    noResults: 'Keine Ergebnisse',
    noResultsFor: 'Keine Ergebnisse für „{query}“',
  },
  modal: {
    close: 'Schließen',
    untitled: 'Dialog',
  },
  confirmDialog: {
    cancel: 'Abbrechen',
    confirm: 'Bestätigen',
  },
  spinner: {
    label: 'Wird geladen',
    visible: '{label} …',
  },
  palette: {
    legend: 'Farbschema',
    triggerWithPalette: 'Farbschema: {palette}',
    options: {
      plaza: { label: 'Plaza', description: 'Warmer Sand · Standard' },
      sakura: { label: 'Sakura-Park', description: 'Blüte und Pflaume' },
      mountain: { label: 'Bergpass', description: 'Wiese und Fichte' },
      clouds: { label: 'Himmelsinsel', description: 'Wolken und Schiefer' },
    },
  },
  avatar: {
    alt: 'Avatar von {name}',
  },
  categoryIcon: {
    unknown: 'Unbekannte Kategorie',
    alt: 'Kategorie: {category}',
  },
  pokemonAutocomplete: {
    placeholder: 'Pokémon-Name',
    searching: 'Suche läuft …',
    noResults: 'Keine Ergebnisse',
  },
  scope: {
    label: 'Bereich',
    globalOnly: 'Ratings gibt es nur global',
    global: 'Global (gesamte Zeit)',
    league: 'Liga',
    tournament: 'Turnier',
  },
  resourceAdmins: {
    loading: 'Admins werden geladen …',
    none: 'Keine Ressourcen-Admins zugewiesen.',
    remove: 'Entfernen',
    selectPlayer: 'Spieler auswählen …',
    add: 'Admin hinzufügen',
  },
  archive: {
    archive: 'Archivieren',
    unarchive: 'Wiederherstellen',
    busy: '…',
    confirmArchive: {
      season: 'Diese Liga archivieren? Sie wird aus den öffentlichen Listen ausgeblendet.',
      tournament: 'Dieses Turnier archivieren? Es wird aus den öffentlichen Listen ausgeblendet.',
    },
    confirmUnarchive: {
      season: 'Diese Liga wiederherstellen? Sie erscheint wieder in den öffentlichen Listen.',
      tournament: 'Dieses Turnier wiederherstellen? Es erscheint wieder in den öffentlichen Listen.',
    },
    failed: 'Aktualisieren fehlgeschlagen',
  },
  deleteResource: {
    label: 'Löschen',
    confirm: {
      season:
        'Liga „{name}“ löschen? Sie wird mit allen abhängigen Einträgen entfernt. Das lässt sich nicht rückgängig machen.',
      tournament:
        'Turnier „{name}“ löschen? Es wird mit allen abhängigen Einträgen entfernt. Das lässt sich nicht rückgängig machen.',
    },
    failed: {
      season: 'Die Liga konnte nicht gelöscht werden.',
      tournament: 'Das Turnier konnte nicht gelöscht werden.',
    },
  },
  description: {
    empty: 'Noch keine Beschreibung. Füge eine hinzu, damit Professor Linden die Sonderregeln der Liga versteht.',
    edit: 'Beschreibung bearbeiten',
    add: 'Beschreibung hinzufügen',
    placeholder:
      'Beschreibe Sonderregeln, Typ-Beschränkungen, Einschränkungen usw. Professor Linden nutzt das für die Spielanalyse.',
    save: 'Speichern',
    cancel: 'Abbrechen',
    failed: 'Speichern fehlgeschlagen',
  },
});
