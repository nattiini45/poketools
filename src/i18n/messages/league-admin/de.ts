import { defineDe } from '@/i18n/define';
import type en from './en';
import { formatPack } from '@/lib/format-pack';

const P = formatPack.messages.de.leagueAdmin;

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
    namePlaceholder: 'z. B. Frühjahrsliga 2026',
    description: 'Beschreibung (optional)',
    descriptionPlaceholder:
      'z. B. Jeder Teilnehmer ist zu 60 % an einen Typ gebunden. Beschreibe Typzuteilungen, Sonderregeln usw.',
    leagueType: 'Liga-Typ',
    leagueTypeOption: {
      singles: 'Klassisch: Einzel',
      doubles: 'Klassisch: Doppel',
      draft: 'Draft',
      evolution_point_buy: P.form.leagueTypeLabel,
    },
    battleFormatFixed: 'Kampfformat: Einzel (fest)',
    worldTheme: '3D-Welt-Thema',
    ruleset: 'Battle-Regelwerk (optional)',
    noRuleset: 'Kein Standard-Regelwerk',
    autoRuleset: 'Battle-Regelwerk: {ruleset} (wird automatisch gesetzt)',
    autoRulesetHint:
      'Bans kommen aus den Formatregeln dieser Liga (nach dem Anlegen pro Liga änderbar). Neue Phasen dieser Liga nutzen standardmäßig dieses Regelwerk.',
    autoRulesetName: P.form.battleRulesetName,
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
    label: 'Testliga – mit Testliga-Badge gelistet, nicht in Ratings und Gesamtstatistiken',
    hint: 'Die Liga bleibt gelistet (nach den echten Ligen, mit Badge), damit die Community darin testen kann. Ihre Spiele zählen nicht für die Spieler-Ratings: Wenn du die Einstellung änderst, werden die Ratings der Liga-Spieler neu aufgebaut. Spiele, die vor dem Setzen der Markierung erfasst wurden, bleiben in den Gesamtstatistiken.',
    saving: 'Wird gespeichert, Ratings werden neu aufgebaut …',
    saveFailed: 'Die Testliga-Markierung konnte nicht geändert werden',
    ratingRebuildWarning: 'Neuaufbau der Ratings: {warning}',
    saveUnconfirmed:
      'Es kam keine Antwort, das Speichern ist also nicht bestätigt. Die Checkbox zeigt jetzt die gespeicherte Einstellung. Falls die Ratings nicht neu aufgebaut wurden, kann ein Site-Admin sie mit dem Datenabgleich in den Admin-Datenwerkzeugen reparieren und die Reparatur wiederholen, bis ihr Probelauf keine Rating-Abweichung mehr auflistet.',
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
      kill_difference: 'KO-Differenz',
      head_to_head: 'Direkter Vergleich',
      decision_match: 'Entscheidungsspiel',
    },
  },
  phasePage: {
    subtitle: '{league} · Phase {order} · {bracket} · {bestOf} · {status}',
    back: '← Zurück zu {name}: Phasen',
    newPhaseHint:
      'Schritt 2: Die Teilnehmer werden aus der Ligatabelle eingetragen. Passe bei Bedarf die Setzplätze an und erstelle dann unten den Turnierbaum.',
    overview: 'Übersicht',
    description: 'Beschreibung',
    participants: 'Teilnehmer',
    groups: 'Gruppen',
    rounds: 'Runden',
  },
});
