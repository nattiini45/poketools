import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  list: {
    title: 'Ligen verwalten',
    viewArchived: 'Archiv anzeigen',
    newLeague: '+ Neue Liga',
    empty: 'Noch keine Ligen.',
    stages: { one: '{count} Phase', other: '{count} Phasen' },
    testBadge: 'Test',
  },
  archived: {
    title: 'Archivierte Ligen',
    back: 'Zurück zu den Ligen',
    empty: 'Keine archivierten Ligen.',
    badge: 'Archiviert',
  },
  create: {
    title: 'Liga erstellen',
  },
  form: {
    name: 'Name der Liga',
    namePlaceholder: 'z. B. PLC Saison 5',
    description: 'Beschreibung (optional)',
    descriptionPlaceholder:
      'z. B. Jeder Teilnehmer ist zu 60 % an einen Typ gebunden. Beschreibe Typzuteilungen, Sonderregeln usw.',
    formatType: 'Format',
    worldTheme: '3D-Welt-Thema',
    ruleset: 'Regelwerk (optional)',
    noRuleset: 'Kein Standard-Regelwerk',
    contentLanguage: 'Inhaltssprache (Discord, Berichte, Overlays)',
    contentLanguageHint:
      'Die Sprache für Texte, die niemand hier auf der Seite liest: Discord-Posts, gespeicherte KI-Berichte und Stream-Overlays. Besucher sehen die Seite immer in ihrer eigenen Sprache.',
    startDate: 'Startdatum',
    endDate: 'Enddatum',
    submit: 'Liga erstellen',
    saveFailed: 'Speichern fehlgeschlagen',
  },
  theme: {
    label: 'Thema',
    auto: 'Automatisch (Standard des Formats)',
    saving: 'Wird gespeichert …',
    saveFailed: 'Das Thema konnte nicht geändert werden',
  },
  status: {
    label: 'Status:',
    saveFailed: 'Der Status konnte nicht geändert werden',
  },
  testFlag: {
    label: 'Testliga – nicht in öffentlichen Listen und Gesamtstatistiken',
    hint: 'Die Liga bleibt über ihren eigenen Link erreichbar. Spiele, die vor dem Setzen der Markierung erfasst wurden, bleiben in den Gesamtstatistiken.',
    saving: 'Wird gespeichert …',
    saveFailed: 'Die Testliga-Markierung konnte nicht geändert werden',
  },
  formatRules: {
    loading: 'Formatregeln werden geladen …',
    loadFailed: 'Die Formatregeln konnten nicht geladen werden',
    empty: 'Noch keine Formatregeln eingerichtet. Mit den Standardregeln für Evolution Point Buy einrichten?',
    initialize: 'Standardregeln einrichten',
    initializing: 'Wird eingerichtet …',
    initializeFailed: 'Die Formatregeln konnten nicht eingerichtet werden',
    saved: 'Formatregeln gespeichert.',
    picks: 'Picks',
    tokenRatio: '{token}-Verhältnis',
    tokenMax: '{token}-Limit',
    ratioValue: '{ratio}:1',
    bannedMoves: 'Gebannte Attacken',
    bannedItems: 'Gebannte Items',
    teraRules: 'Tera-Regeln',
    teraRule: '{stage}: {rule}',
    tiebreakerOrder: 'Tiebreaker-Reihenfolge',
    tiebreaker: {
      match_points: 'Spielpunkte',
      kill_difference: 'Kill-Differenz',
      head_to_head: 'Direkter Vergleich',
      decision_match: 'Entscheidungsspiel',
    },
  },
  phasePage: {
    subtitle: '{league} · Phase {order} · {bracket} · {bestOf} · {status}',
    back: '← Zurück zu {name}',
    newPhaseHint:
      'Schritt 2: Die Teilnehmer werden aus der Ligatabelle eingetragen. Passe bei Bedarf die Setzplätze an und erstelle dann unten den Turnierbaum.',
    overview: 'Übersicht',
    description: 'Beschreibung',
    participants: 'Teilnehmer',
    groups: 'Gruppen',
    rounds: 'Runden',
  },
});
