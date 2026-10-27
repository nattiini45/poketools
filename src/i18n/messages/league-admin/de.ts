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
  trash: {
    title: 'Liga-Papierkorb',
    subtitle:
      'Gelöschte Ligen bleiben hier {days} Tage lang erhalten. Eine Wiederherstellung bringt eine Liga mit ihren Phasen, Matches, Spielen, Drafts und Einstellungen zurück, oder stellt gar nichts wieder her.',
    back: 'Zurück zu den Ligen',
    link: 'Liga-Papierkorb',
    empty: 'Der Papierkorb ist leer.',
    caption: 'Gelöschte Ligen',
    columns: {
      league: 'Liga',
      format: 'Format',
      deletedBy: 'Gelöscht von',
      deletedAt: 'Gelöscht am',
      restorableUntil: 'Wiederherstellbar bis',
      contents: 'Inhalt',
      status: 'Status',
      actions: 'Aktionen',
    },
    deletedByUnknown: 'Unbekannt',
    counts: {
      players: { one: '{count} Spieler', other: '{count} Spieler' },
      phases: { one: '{count} Phase', other: '{count} Phasen' },
      matches: { one: '{count} Match', other: '{count} Matches' },
      games: { one: '{count} Spiel', other: '{count} Spiele' },
      draftPools: { one: '{count} Draft-Pool', other: '{count} Draft-Pools' },
    },
    badges: {
      schemaChanged: 'Schema seit dem Löschen geändert',
      rebuildPending: 'Neuaufbau ausstehend',
      ready: 'Bereit zur Wiederherstellung',
    },
    schemaChangedHint:
      'Das Datenbankschema hat sich geändert, nachdem die so markierten Ligen gelöscht wurden. Eine Wiederherstellung prüft die gespeicherte Kopie gegen die aktuellen Tabellen und stellt nichts wieder her, wenn sie nicht mehr passen.',
    restore: {
      button: 'Wiederherstellen',
      buttonLabel: 'Liga {name} wiederherstellen',
      blocked: 'Führe zuerst den ausstehenden Neuaufbau dieses Löschens aus.',
      confirmTitle: 'Liga wiederherstellen?',
      confirmMessage:
        'Liga „{name}“ aus dem Papierkorb wiederherstellen? Sie kommt mit ihren Matches, Spielen und Drafts zurück. Laufende Drafts kommen pausiert zurück, und jede Frist verschiebt sich um die Zeit, die die Liga im Papierkorb lag.',
      confirmAction: 'Liga wiederherstellen',
      failedTitle: 'Liga „{name}“ konnte nicht wiederhergestellt werden.',
    },
    pending: {
      title: 'Ausstehende Neuaufbauten',
      hint: 'Nach einem Löschen oder einer Wiederherstellung werden Statistiken, Ratings und Siegesserien neu aufgebaut. Dieser Neuaufbau wurde nicht bestätigt. Ihn noch einmal auszuführen ist sicher.',
      kind: { delete: 'Nach dem Löschen', restore: 'Nach der Wiederherstellung' },
      run: 'Neuaufbau starten',
      runLabel: 'Neuaufbau der Liga {name} starten',
      failedTitle: 'Der Neuaufbau der Liga „{name}“ ist fehlgeschlagen.',
    },
    notice: {
      dismiss: 'Ausblenden',
      restored: 'Liga „{name}“ wurde wiederhergestellt.',
      openLeague: 'Liga öffnen',
      pausedPools: {
        one: '{count} laufender Draft kam pausiert zurück. Setze ihn im Draft-Bereich der Liga fort.',
        other: '{count} laufende Drafts kamen pausiert zurück. Setze sie im Draft-Bereich der Liga fort.',
      },
      detailsUnknown:
        'Die Wiederherstellung hat erst nach Ablauf der Anfragezeit geantwortet, ihre Details sind daher unbekannt: Prüfe im Draft-Bereich der Liga, ob Drafts pausiert zurückkamen.',
      warningsTitle: 'Bitte lesen',
      warnings: {
        parent_missing_nulled: {
          one: '{count} Eintrag in {rel} verwies auf etwas, das gelöscht wurde, während die Liga im Papierkorb lag. Der Verweis {column} wurde geleert.',
          other:
            '{count} Einträge in {rel} verwiesen auf etwas, das gelöscht wurde, während die Liga im Papierkorb lag. Der Verweis {column} wurde geleert.',
        },
        replay_hash_released: {
          one: '{count} wiederhergestelltes Spiel nutzte ein Replay, das jetzt ein anderes Spiel nutzt. Der Replay-Link dieses Spiels wurde entfernt.',
          other: '{count} wiederhergestellte Spiele nutzten ein Replay, das jetzt ein anderes Spiel nutzt. Der Replay-Link dieser Spiele wurde entfernt.',
        },
        columns_ignored: {
          one: 'Die Tabelle {rel} hat die Spalte {columns} nicht mehr. Die gespeicherten Werte dieser Spalte wurden nicht wiederhergestellt.',
          other: 'Die Tabelle {rel} hat die Spalten {columns} nicht mehr. Die gespeicherten Werte dieser Spalten wurden nicht wiederhergestellt.',
        },
        pointer_unknown: {
          one: '{count} Eintrag in {rel} verwies über {column} auf die Liga, einen Verweis, den es nach einem Update nicht mehr gibt. Er wurde nicht wieder verknüpft.',
          other:
            '{count} Einträge in {rel} verwiesen über {column} auf die Liga, einen Verweis, den es nach einem Update nicht mehr gibt. Sie wurden nicht wieder verknüpft.',
        },
      },
      rebuilt: 'Der Neuaufbau der Liga „{name}“ ist fertig.',
      rebuildIncomplete: 'Der Neuaufbau wurde nicht abgeschlossen:',
    },
    failed: 'Die Anfrage ist fehlgeschlagen.',
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
      custom: 'Eigenes Format (Format Studio)',
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
    saveChanges: 'Änderungen speichern',
    saved: 'Liga-Einstellungen gespeichert.',
    datesInvalid: 'Das Enddatum darf nicht vor dem Startdatum liegen.',
    leagueTypeLockedStarted:
      'Der Liga-Typ lässt sich nicht mehr ändern: Die Liga ist gestartet (sie ist aktiv oder abgeschlossen, oder eine Phase hat Runden).',
    leagueTypeLockedPointBuy:
      'Eine Point-Buy-Liga behält ihren Liga-Typ, und andere Ligen können keine werden: Ihre Einrichtung (Formatregeln, Point-Buy-Liste, Battle-Regelwerk) wird zusammen mit der Liga angelegt.',
    rulesetLockedHint:
      'Die Liga hat begonnen, ihr Regelwerk lässt sich hier nicht mehr austauschen. Eine neuere Version desselben Regelwerks übernimmst du mit der Regelwerk-Karte darunter.',
    rulesetEditHint:
      'Der Standard für neue Phasen und für die Teamprüfung, wo eine Phase kein eigenes Custom-Regelwerk hat. Bestehende Phasen behalten ihres.',
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
    retry: 'Erneut versuchen',
    initializeConfirm: {
      title: 'Standardregeln einrichten?',
      message:
        'Damit legst du die Standardregeln für diese Liga an: Budget {budget}, {picks} Picks, {token}-Verhältnis {ratio}:1, {token}-Limit {tokenMax} ({perLine} pro Linie) und {bans} Standard-Bans. Du kannst sie danach bearbeiten.',
      confirm: 'Einrichten',
    },
    save: 'Formatregeln speichern',
    saving: 'Wird gespeichert …',
    reset: 'Zurücksetzen',
    unsavedHint: 'Du hast ungespeicherte Änderungen.',
    saved: 'Formatregeln gespeichert.',
    saveFailed: 'Die Formatregeln konnten nicht gespeichert werden',
    picks: 'Picks',
    tokenRatio: '{token}-Verhältnis',
    tokenMax: '{token}-Limit',
    perLineLimit: '{token}-Limit pro Linie',
    range: '{min}–{max}',
    ratioValue: '{ratio}:1',
    poolHint:
      'Budget und Picks gelten für Draft-Pools, die nach dem Speichern angelegt werden. Bestehende Draft-Pools behalten ihre Werte.',
    bannedMoves: 'Gebannte Attacken',
    bannedItems: 'Gebannte Items',
    teraRules: 'Tera-Regeln',
    teraRule: '{stage}: {rule}',
    teraPinned: 'Die Tera-Regeln kommen aus dem Format Pack und lassen sich hier nicht ändern.',
    redraftPhase: {
      label: 'Redraft-Phase',
      open: 'Offen',
      closed: 'Geschlossen',
      hint: 'Die Redraft-Phase öffnest und schließt du im Bereich Redraft auf dem Tab Draft, nicht hier.',
    },
    tiebreakerOrder: 'Tiebreaker-Reihenfolge',
    tiebreakerHint:
      'Die Tabelle sortiert die Spieler nach dieser Reihenfolge, der erste Schritt zuerst, und die Regelseite der Liga zeigt sie an. Ein Entscheidungsspiel steht, falls vorhanden, ganz am Ende und markiert nur Spieler, die dann noch gleichauf sind.',
    tiebreakerMoveUp: '{step} nach oben',
    tiebreakerMoveDown: '{step} nach unten',
    tiebreakerRemove: '{step} entfernen',
    addStep: 'Schritt hinzufügen',
    addStepNone: 'Alle Tiebreaker-Schritte stehen schon in der Liste.',
    tiebreaker: {
      match_points: 'Spielpunkte',
      evolution_points: 'Evolutionspunkte',
      kill_difference: 'KO-Differenz',
      head_to_head: 'Direkter Vergleich',
      decision_match: 'Entscheidungsspiel',
    },
    confirmStarted: {
      title: 'Regeln einer laufenden Liga ändern?',
      message:
        'Diese Liga hat bereits begonnen. Die neuen Regeln gelten ab jetzt. Bisherige Ergebnisse bleiben erhalten und bestehende Draft-Pools werden nicht neu berechnet, die Tabelle wird aber sofort nach der neuen Tiebreaker-Reihenfolge sortiert.',
      confirm: 'Regeln speichern',
    },
    error: {
      required: 'Gib einen Wert ein.',
      notInteger: 'Gib eine ganze Zahl ein.',
      tooSmall: 'Muss mindestens {min} sein.',
      tooBig: 'Darf höchstens {max} sein.',
      empty: 'Das darf nicht leer sein.',
      duplicate: 'Jeder Eintrag darf nur einmal vorkommen.',
      tooLong: 'Namen dürfen höchstens {max} Zeichen lang sein.',
      decisionLast: 'Ein Entscheidungsspiel kann nur der letzte Schritt sein.',
    },
  },
  phasePage: {
    forbidden: 'Nur Admins dieser Liga können ihre Phasen öffnen.',
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
