import { defineDe } from '@/i18n/define';
import { formatPack } from '@/lib/format-pack';
import type en from './en';

const P = formatPack.messages.de.leagueAdminSeasonPage;

export default defineDe<typeof en>()({
  forbidden: 'Nur Admins dieser Liga können ihre Admin-Seite öffnen.',
  header: {
    subtitle: '{format}',
    subtitleWithRuleset: '{format} · {ruleset}',
    archived: '{subtitle} · Archiviert',
    testBadge: 'Test',
  },
  tabs: {
    label: 'Bereiche der Liga-Verwaltung',
    overview: 'Übersicht',
    participants: 'Teilnehmer',
    draft: 'Draft',
    phases: 'Phasen',
    rules: 'Regeln',
    settings: 'Einstellungen',
    danger: 'Gefahrenzone',
    unsavedConfirm: 'Dieser Tab hat ungespeicherte Änderungen. Trotzdem wechseln und sie verwerfen?',
  },
  overview: {
    title: 'Auf einen Blick',
    format: 'Ligatyp',
    battleFormat: 'Kampfformat',
    battleFormatSingles: 'Einzel',
    battleFormatDoubles: 'Doppel',
    ruleset: 'Regelwerk',
    noRuleset: 'Keines',
    participants: 'Teilnehmer',
    phases: 'Phasen',
    status: 'Status',
    dates: 'Zeitraum',
    noDates: 'Nicht festgelegt',
    dateRange: '{start} – {end}',
    startOnly: 'Ab {start}',
    endOnly: 'Bis {end}',
    publicPage: 'Öffentliche Ligaseite öffnen',
  },
  danger: {
    title: 'Gefahrenzone',
    archiveTitle: 'Archivieren',
    archiveHint:
      'Eine archivierte Liga verschwindet aus den aktiven Listen und landet im Archiv. Spiele, Tabelle und Verlauf bleiben erhalten; du kannst sie jederzeit wiederherstellen.',
    deleteTitle: 'Liga löschen',
    deleteIntro: 'Löscht die Liga endgültig, zusammen mit:',
    deletes: {
      participants: 'ihren Teilnehmern',
      groups: 'ihren Liga-Gruppen und deren Mitgliedern',
      rules: 'ihren Formatregeln, Entwicklungsstufen, Tier-Limits und der Draft-Pool-Liste',
      evolution: 'allen Entwicklungsdaten: den gedrafteten Linien, ihrem Fortschritt und den Entwicklungsereignissen',
      tokens: 'allen Token-Vergaben, Draft-Kill-Token-Käufen und eingelösten Comeback-Tokens',
      redraft: 'allen Redraft-Plätzen, Abgaben, Verlaufseinträgen und Tauschanfragen',
    },
    deleteBlocked: 'Das Löschen wird abgelehnt, solange die Liga noch {list} hat. Lösche diese zuerst.',
    blockers: {
      phases: 'Phasen',
      draftPools: 'Draft-Pools',
      teams: 'Teams',
      storylines: 'Storylines',
    },
    deleteUnlinked: 'Cast-Sessions der Liga bleiben erhalten, aber ohne Verbindung zur Liga.',
    deleteFinal: 'Das lässt sich nicht rückgängig machen.',
    deleteSiteAdminOnly: 'Nur Seiten-Admins können eine Liga löschen.',
  },
  description: {
    title: 'Beschreibung',
    subtitle: 'Für Professor Linden sichtbar, als Kontext für die Spielanalyse.',
  },
  settings: {
    details: {
      title: 'Liga-Daten',
      subtitle:
        'Name, Liga-Typ, Battle-Regelwerk und Saisondaten. Die Beschreibung steht im Tab Übersicht; Thema und Sprache folgen darunter.',
    },
  },
  theme: {
    title: '3D-Welt-Thema',
    subtitle: 'Leg das 3D-Welt-Thema der Liga fest oder lass es auf „Automatisch“, dann gilt der Standard des Formats.',
  },
  language: {
    title: 'Inhaltssprache',
    subtitle:
      'Die Sprache der Discord-Posts, gespeicherten KI-Berichte und Stream-Overlays dieser Liga. Besucher sehen die Seite immer in ihrer eigenen Sprache.',
    saving: 'Wird gespeichert …',
    saved: 'Inhaltssprache gespeichert.',
    saveFailed: 'Die Inhaltssprache konnte nicht geändert werden',
  },
  testLeague: {
    title: 'Testliga',
    subtitle:
      'Nur für Seiten-Admins. Markiert eine Liga zum Testen: mit Testliga-Badge gelistet, nicht in Ratings und Gesamtstatistiken.',
  },
  participants: {
    title: 'Teilnehmer',
  },
  typeCores: {
    title: 'Typ-Cores (Core Liga)',
    ...P.typeCores,
  },
  evolutionTiers: {
    title: 'Entwicklungs-Tiers',
    subtitle:
      'Leg fest, welche Pokémon gedraftet werden können und wie viel Entwicklungsfortschritt jede Stufe braucht.',
  },
  draftPool: {
    title: 'Pokémon im Draft-Pool',
    subtitle: 'Füge Pokémon zum Draft-Pool hinzu. Aus diesen Pokémon wählen die Spieler im Draft.',
  },
  draftSettings: {
    title: 'Draft-Einstellungen',
    subtitle: 'Leg die Slot-Limits pro Tier fest. Den Draft selbst erstellst du im Tab Draft.',
  },
  pointBuyList: {
    title: 'Point-Buy-Liste',
    subtitle:
      'Binde eine versionierte Point-Buy-Liste an diese Saison. Die Liste legt alle verfügbaren Entwicklungslinien und ihre Preise fest.',
  },
  formatRules: {
    title: 'Formatregeln',
    subtitle:
      'Bearbeite Draft-Budget, Picks, {token}-Limits, Bans und die gespeicherte Tiebreaker-Reihenfolge. Die Tera-Regeln kommen aus dem Formatpaket und lassen sich hier nicht ändern.',
  },
  draftRoom: {
    title: 'Draft-Raum',
    subtitle: 'Steuere den laufenden Draft.',
    poolActive: 'Draft-Pool aktiv: {type} ({status}). Öffne den <link>Draft-Raum</link>, um die Picks zu verwalten.',
    openPanel: 'Draft-Steuerung öffnen',
    openPanelHint: 'Draft starten, pausieren und korrigieren, den Redraft durchführen und das Protokoll lesen.',
    epbCreate: {
      intro: 'Mit dem Draft-Raum wird dieser Draft angelegt:',
      orderLabel: 'Draft-Reihenfolge',
      order: 'Snake. Die Reihenfolge kehrt sich jede Runde um.',
      seatsLabel: 'Plätze',
      seats: 'Einer pro Teilnehmer.',
      pricesLabel: 'Preise',
      prices: 'Aus der gebundenen Point-Buy-Liste.',
      budgetLabel: 'Budget',
      budget: '{budget} Punkte pro Spieler (Formatregeln).',
      budgetDefault: '{budget} Punkte pro Spieler (Standardwert).',
      rosterLabel: 'Kadergröße',
      roster: { one: '{count} Pick pro Spieler (Formatregeln).', other: '{count} Picks pro Spieler (Formatregeln).' },
      rosterDefault: { one: '{count} Pick pro Spieler (Standardwert).', other: '{count} Picks pro Spieler (Standardwert).' },
      modeLabel: 'Modus',
      mode: { one: 'Live-Draft, {count} Minute pro Pick.', other: 'Live-Draft, {count} Minuten pro Pick.' },
      editHint:
        'Bis der Draft startet, kannst du Draft-Reihenfolge, Budget, Kadergröße, Modus und Timer in der Draft-Steuerung ändern.',
      create: 'Draft-Raum erstellen',
      createFailed: 'Der Draft-Raum konnte nicht erstellt werden.',
    },
    bindListFirst:
      'Binde zuerst im Tab <link>Regeln</link> eine Point-Buy-Liste. Sie legt fest, welche Entwicklungslinien im Draft verfügbar sind.',
    addParticipantsFirst: 'Füge zuerst im Tab <link>Teilnehmer</link> Spieler hinzu. Jeder bekommt einen Platz im Draft.',
    tooFewParticipants: 'Ein Draft braucht mindestens {min} Teilnehmer, diese Liga hat {count}. Füge zuerst im Tab <link>Teilnehmer</link> weitere Spieler hinzu.',
    tooManyParticipants: 'Ein Draft hat Platz für höchstens {max} Teilnehmer, diese Liga hat {count}. Entferne zuerst welche im Tab <link>Teilnehmer</link>.',
  },
  dataImport: {
    title: 'Datenimport',
    subtitle:
      'Importiere die Point-Buy-Liste und die Team-Rollen aus den maßgeblichen xlsx-Tabellen (mit Probelauf-Vorschau).',
  },
  tokens: {
    title: 'Tokens',
    subtitle:
      'Stände pro Spieler: {draftKill}, {comeback} und {cosmo}. Die Spieler kaufen und setzen ihre Tokens selbst ein.',
  },
  evolutionPoints: {
    title: 'Evolutionspunkte',
    subtitle: 'Tiebreaker in der Tabelle: höchstens 1 pro Trainer und Spieltag, wenn sich eine seiner Linien entwickelt.',
  },
  redraft: {
    title: 'Redraft',
    subtitle: 'Der Redraft zwischen Hin- und Rückrunde (verdeckte Abgabe) läuft in der Draft-Steuerung.',
    openPanel: 'Redraft in der Draft-Steuerung öffnen',
  },
  phases: {
    title: 'Phasen',
  },
  leagueAdmins: {
    title: 'Liga-Admins',
    subtitle: 'Liga-Admins können alle Phasen dieser Liga verwalten.',
  },
});
