import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  form: {
    name: 'Name der Phase',
    namePlaceholder: 'z. B. Gruppenphase, Playoffs',
    description: 'Beschreibung (optional)',
    bracketType: 'Turniermodus',
    ruleset: 'Regelwerk',
    selectRuleset: 'Regelwerk auswählen …',
    bestOf: 'Best of (Standard)',
    teamVisibility: 'Sichtbarkeit der Teams',
    advancement: 'Weiterkommen in die nächste Phase',
    advancementPlayers: 'Spieler',
    perGroup: 'je Gruppe',
    advancementHint: '0 heißt: niemand kommt weiter (letzte Phase). Wird auf der Karte der vorherigen Phase angezeigt.',
    submit: 'Phase speichern',
    saveFailed: 'Speichern fehlgeschlagen',
  },
  overview: {
    saved: 'Phaseneinstellungen gespeichert.',
    saveChanges: 'Änderungen speichern',
  },
  timeline: {
    loading: 'Phasen werden geladen …',
    heading: 'Phasen ({count})',
    create: '+ Phase erstellen',
    cancel: 'Abbrechen',
    empty: 'Noch keine Phasen – erstelle die erste Phase.',
    advancesTop: 'Top {count} →',
    advancesTopPerGroup: 'Top {count} je Gruppe →',
    enrolled: '{count} eingetragen',
    rounds: 'Runden {done}/{total}',
    moveUp: 'Phase nach oben verschieben',
    moveDown: 'Phase nach unten verschieben',
    manage: 'Verwalten',
    delete: 'Löschen',
    confirmDelete: 'Phase „{name}“ löschen?',
    confirmDeleteWithRounds:
      'Phase „{name}“ mit allen Runden und Spielen löschen? Das lässt sich nicht rückgängig machen.',
    newPhaseTitle: 'Neue Phase – Schritt 1: Einstellungen',
    newPhaseHint: 'Nach dem Erstellen werden die Teilnehmer automatisch aus der Ligatabelle eingetragen.',
    createSubmit: 'Erstellen und Teilnehmer eintragen',
    errors: {
      loadFailed: 'Phasen konnten nicht geladen werden',
      deleteFailed: 'Phase konnte nicht gelöscht werden',
      reorderFailed: 'Phasen konnten nicht neu angeordnet werden',
    },
    deletedWithWarning: 'Phase „{name}“ wurde gelöscht.',
    openDataTools: 'Admin-Datenwerkzeuge öffnen',
  },
  groups: {
    loading: 'Gruppen werden geladen …',
    groupCount: 'Anzahl der Gruppen',
    groupCountOption: { one: '{count} Gruppe', other: '{count} Gruppen' },
    serpentine: 'Nach Setzplätzen im Snake-System verteilen',
    clear: 'Gruppen leeren',
    confirmClear: 'Alle Gruppen und Gruppenzuteilungen entfernen?',
    empty: 'Noch keine Gruppen. Setze zuerst die Teilnehmer und verteile sie dann im Snake-System (1→A, 2→B, 3→B, 4→A …).',
    noMembers: 'Keine Mitglieder',
    moveAria: '{name} verschieben',
    leagueManaged:
      'Diese Liga hat Gruppen, deshalb folgt diese Phase ihnen: Ihre Gruppen entstehen aus den Ligagruppen, sobald ihre erste Runde erzeugt wird. Ändere die Gruppen im Tab <link>Teilnehmer</link> der Liga.',
    placementPause:
      '„Alle Runden erstellen“ hält vor jeder Platzierungswoche an: In dieser Woche spielen die Gleichplatzierten der Gruppen nach Tabelle gegeneinander, deshalb lässt sie sich erst erzeugen, wenn alle früheren Spiele abgeschlossen sind. Erstelle dann erneut, um weiterzumachen.',
    errors: {
      loadFailed: 'Gruppen konnten nicht geladen werden',
      assignFailed: 'Gruppen konnten nicht verteilt werden',
      clearFailed: 'Gruppen konnten nicht geleert werden',
      moveFailed: 'Spieler konnte nicht verschoben werden',
    },
  },
  repair: {
    title: 'Gruppeneinträge nach Spielerwechseln',
    intro:
      'Wechsel aus der Zeit, bevor Gruppeneinträge mit dem Platz mitgewandert sind, haben den Eintrag beim ausgeschiedenen Spieler gelassen. „Prüfen“ findet diese Einträge und den eingetragenen Ersatzspieler, dem sie zustehen.',
    rechecked:
      'Nach dem Fehler erneut geprüft: Was davor übergeben wurde, bleibt übergeben, und die Liste unten zeigt, was noch offen ist.',
    check: 'Gruppeneinträge prüfen',
    apply: 'Reparatur anwenden',
    confirmApply: {
      one: '{count} Gruppeneintrag an den eingetragenen Ersatzspieler übergeben? Ungeklärte Fälle bleiben, wie sie sind.',
      other: '{count} Gruppeneinträge an die eingetragenen Ersatzspieler übergeben? Ungeklärte Fälle bleiben, wie sie sind.',
    },
    noGroups: 'Diese Phase hat keine Gruppen.',
    noMoves: 'Keine Gruppeneinträge zu übergeben.',
    movesHeading: 'Zu übergebende Einträge ({count})',
    orphanedHeading: 'Einträge von Spielern, die nicht mehr eingetragen sind ({count})',
    ungroupedHeading: 'Eingetragene Spieler ohne Gruppe ({count})',
    unresolvedNote: 'Ungeklärte Fälle bleiben, wie sie sind.',
    historyTruncated:
      'Nur die neuesten Wechseleinträge wurden gelesen; Einträge aus älteren Wechseln wurden allein über den Spielplan zugeordnet.',
    fixturesTruncated:
      'Nur die ältesten {count} Spiele dieser Phase wurden gelesen; bei der Zuordnung über den Spielplan können neuere Spiele fehlen.',
    unreadable: {
      one: '{count} Wechseleintrag konnte nicht gelesen werden und wurde übersprungen.',
      other: '{count} Wechseleinträge konnten nicht gelesen werden und wurden übersprungen.',
    },
    handedOverNone: 'Es mussten keine Gruppeneinträge übergeben werden.',
    handedOver: {
      one: '{count} Gruppeneintrag übergeben:',
      other: '{count} Gruppeneinträge übergeben:',
    },
    basis: {
      audit: 'Wechselprotokoll',
      fixtures: 'Spielplan',
    },
    rowReason: {
      no_counterpart: 'kein Ersatzspieler gefunden',
      ambiguous: 'mehr als ein Ersatzspieler passt',
      several_rows: 'hat Einträge in mehreren Gruppen',
    },
    playerReason: {
      no_counterpart: 'kein freier Platz gefunden',
      ambiguous: 'mehr als ein Platz passt',
    },
    errors: {
      checkFailed: 'Gruppeneinträge konnten nicht geprüft werden',
      repairFailed: 'Gruppeneinträge konnten nicht repariert werden',
    },
  },
});
