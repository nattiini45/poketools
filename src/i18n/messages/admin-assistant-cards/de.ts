import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  classes: {
    read: 'Nachschlagen',
    preview: 'Vorschau',
    draft: 'Entwurf',
    change: 'Änderung',
    goLive: 'Live schalten',
  },

  titles: {
    ruleset: 'Regelwerk',
    format: 'Format',
    league: 'Liga',
    phase: 'Phase',
    schedule: 'Spielplan',
    roster: 'Kader',
    draft: 'Draft-Einrichtung',
    tournament: 'Turnier',
    clarification: 'Eine Frage',
    capabilityGap: 'Nicht unterstützt',
    change: 'Vorgeschlagene Änderung',
    build: 'Bauen',
    goLive: 'Live schalten',
    progress: 'Fortschritt',
    undo: 'Rückgängig',
    drift: 'Außerhalb des Chats geändert',
  },

  status: {
    notExecuted: 'Noch nicht ausgeführt',
    executing: 'Läuft',
    executed: 'Ausgeführt',
    failed: 'Fehlgeschlagen',
    unknown: 'Unbekannt',
    stale: 'Veraltet',
    declined: 'Abgelehnt',
    expired: 'Abgelaufen',
    superseded: 'Durch eine neuere Karte ersetzt',
    skipped: 'Übersprungen',
  },

  actions: {
    approve: 'Bestätigen',
    decline: 'Ablehnen',
    build: 'Bauen',
    cancel: 'Abbrechen',
    resume: 'Fortsetzen',
    undo: 'Rückgängig',
    undoSteps: 'Diese Schritte rückgängig machen',
    openEditor: 'Im Editor öffnen',
    accept: 'Übernehmen',
    reject: 'Verwerfen',
    refresh: 'Aktualisieren',
    adapt: 'Assistenten anpassen lassen',
    answer: 'Antworten',
    skip: 'Überspringen',
    search: 'Suchen',
    pick: 'Auswählen',
    applyFix: 'Korrektur anwenden',
    choose: 'Wählen',
  },

  build: {
    steps: { one: '{count} Schritt', other: '{count} Schritte' },
    creates: { one: 'Erstellt {count} Eintrag', other: 'Erstellt {count} Einträge' },
    visiblePublicly: 'Sofort öffentlich sichtbar, sobald es erstellt ist',
    pinsRuleset: 'Pinnt {ruleset} in Version {version}',
    publishesRuleset: 'Macht {ruleset} in Version {version} öffentlich lesbar',
    lockedAfter: 'Danach sind der Turnierbaum-Typ und das Regelwerk gesperrt',
    willNotDo: 'Dieser Bau startet die Liga nicht und veröffentlicht nichts.',
    engineGapWarning: 'Die Engine deckt nicht ab: {gap}',
  },

  ack: {
    heading: 'Bevor du bestätigst',
    visiblePublicly: 'Mir ist klar, dass das sofort für alle sichtbar ist.',
    outwardEffects: 'Mir ist klar, dass dabei in Discord- und Social-Kanälen gepostet werden kann.',
    typedName: 'Tipp zur Bestätigung den Namen ein: {name}',
    typedNameLabel: 'Name',
    required: 'Setz alle Häkchen, um „Bestätigen“ freizuschalten.',
  },

  effects: {
    heading: 'Was dadurch ausgelöst wird',
    events: 'Ereignisse',
    channels: { one: '{count} passender Kanal', other: '{count} passende Kanäle' },
    channelsUnknown: 'Kann in Discord- und Social-Kanälen posten; die App kann dir nicht sagen, in welchen.',
    pairings: 'Paarungen mit Spielernamen',
    contentLanguage: 'Die Beiträge sind auf {language} geschrieben',
    aiText: 'Eine KI-Vorschau oder -Zusammenfassung kann erzeugt werden',
  },

  reversibility: {
    undoUntil: 'Rückgängig machen möglich bis {time}',
    undoAvailable: 'Rückgängig machen möglich',
    irreversible: 'Lässt sich nicht rückgängig machen: {reversal}',
    leftAlone: 'Unberührt gelassen: außerhalb des Chats bearbeitet',
  },

  expiry: {
    expiresIn: 'Läuft ab in {time}',
    expired: 'Abgelaufen',
  },

  details: {
    toggle: 'Technische Details',
    method: 'Methode',
    path: 'Pfad',
    body: 'Body',
    planCode: 'Plan-Code',
    empty: 'Keine',
  },

  summary: {
    label: 'Zusammenfassung des Assistenten',
    stepOutcome: 'Schritt {number}: {title}',
    ledgerId: 'Referenz {id}',
    hiddenCharacters: { one: 'Enthält {count} verborgenes Zeichen', other: 'Enthält {count} verborgene Zeichen' },
  },
});
