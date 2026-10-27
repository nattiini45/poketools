import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  name: 'Assistent',
  badge: 'KI',

  drawer: {
    open: 'Assistent öffnen',
    close: 'Assistent schließen',
    title: 'Assistent',
    openFullView: 'Vollansicht öffnen',
    resize: 'Größe des Assistenten ändern',
    shortcutHint: 'Drück die Punkt-Taste, um den Assistenten zu öffnen, und Esc, um ihn zu schließen',
  },

  page: {
    title: 'Assistent',
    intro:
      'Beschreib eine Liga, ein Regelwerk oder ein Turnier in deinen eigenen Worten. Der Assistent bereitet einen Plan vor, und du bestätigst jede Änderung.',
    newConversation: 'Neue Unterhaltung',
    conversations: 'Unterhaltungen',
    back: 'Zurück zu den Unterhaltungen',
    untitled: 'Neue Unterhaltung',
    emptyList:
      'Noch keine Unterhaltungen. Starte eine, um eine Liga, ein Regelwerk oder ein Turnier einzurichten.',
    transcript: 'Unterhaltung',
    planPanel: 'Plan',
  },

  list: {
    updated: 'Aktualisiert {time}',
    planProgress: 'Plan {done}/{total}',
    waitingForYou: 'Wartet auf dich',
    partialBuild: 'Teilweise gebaut',
    readOnly: 'Nur lesen',
    delete: 'Unterhaltung löschen',
  },

  composer: {
    label: 'Nachricht an den Assistenten',
    placeholder: 'z. B. Eine Gen-9-OU-Liga mit 12 Spielern, doppeltes Jeder gegen jeden, Top-4-Playoffs, Start nächsten Montag',
    send: 'Senden',
    stop: 'Stopp',
    continue: 'Weitermachen',
    sending: 'Wird gesendet …',
    charsLeft: { one: 'Noch {count} Zeichen', other: 'Noch {count} Zeichen' },
    tooLong: 'Zu lang: Kürze die Nachricht auf höchstens {max} Zeichen.',
    hint: 'Enter zum Senden, Shift+Enter für eine neue Zeile.',
  },

  transcript: {
    you: 'Du',
    assistant: 'Assistent',
    summaryLabel: 'Zusammenfassung des Assistenten',
    notice: 'Der Assistent kann sich irren. Prüf jede Karte, bevor du bestätigst.',
    working: 'Der Assistent arbeitet …',
    lookingUp: 'Wird nachgeschlagen …',
    toolDone: 'Fertig',
    toolFailed: 'Fehlgeschlagen',
    jumpToLatest: 'Zur neuesten Nachricht',
    earlier: 'Frühere Nachrichten',
  },

  plan: {
    title: 'Plan',
    longTitle: 'Einrichtungsplan',
    revision: 'Revision {number}',
    empty: 'Der Plan füllt sich, während du beschreibst, was du willst.',
    sections: {
      ruleset: 'Regelwerk',
      format: 'Format',
      league: 'Liga',
      phases: 'Phasen',
      roster: 'Kader',
      groups: 'Gruppen',
      draft: 'Draft',
      tournament: 'Turnier',
      assumptions: 'Annahmen',
      nextSteps: 'Nächste Schritte',
    },
    chips: {
      needsInput: 'Angabe nötig',
      assumed: 'Angenommen',
      ready: 'Bereit',
      blockedSiteAdmin: 'Blockiert: Site-Admin nötig',
      engineGap: 'Von der Engine nicht abgedeckt',
      built: 'Gebaut',
      editedOutside: 'Außerhalb des Chats bearbeitet',
    },
    why: {
      label: 'Warum?',
      adminSaid: 'Das hast du gesagt',
      default: 'Standardwert',
      inferred: 'Aus deinem Text abgeleitet',
      liveEntity: 'Aus dem bestehenden Eintrag gelesen ({entity})',
    },
    build: 'Bauen',
    buildBlocked: 'Bauen ist noch nicht möglich',
    fix: 'Beheben',
    edit: 'Bearbeiten',
    expand: 'Plan anzeigen',
    collapse: 'Plan ausblenden',
  },

  states: {
    loading: 'Wird geladen …',
    empty: 'Hier ist noch nichts.',
    offline: 'Die Verbindung ist abgebrochen. Lade die Seite neu, um zu sehen, wo die Unterhaltung steht.',
    reconnecting: 'Verbindung wird wiederhergestellt …',
    waitingForConfirm: 'Wartet auf deine Bestätigung auf der Karte.',
    readOnlyRole: 'Deine Rolle hat sich geändert, deshalb ist diese Unterhaltung nur lesbar. Starte eine neue Unterhaltung.',
    contextFull:
      'Diese Unterhaltung ist fast voll. Starte eine neue Unterhaltung, um weiterzumachen; der Plan wird übernommen.',
    budgetWarning: 'Diese Unterhaltung hat {spent} von {cap} verbraucht.',
    budgetStopped: 'Diese Unterhaltung hat ihr Limit von {cap} erreicht.',
    phaseOnly: 'Der Assistent kann vorerst nur nachschlagen; Änderungen sind noch nicht freigeschaltet.',
    drift: 'Seit dem letzten Nachschlagen des Assistenten hat sich außerhalb des Chats etwas geändert.',
    driftRefresh: 'Aktualisieren',
    driftAdapt: 'Assistenten anpassen lassen',
  },

  newConversation: {
    title: 'Neue Unterhaltung',
    fromLeague: 'Den Assistenten zu dieser Liga fragen',
    newLeague: 'Neue Liga mit Assistent',
    describeRuleset: 'Ein Regelwerk beschreiben',
    describeFormat: 'Ein Format beschreiben',
    fixWithAssistant: 'Mit dem Assistenten beheben',
  },

  errors: {
    generic: 'Der Assistent konnte nicht antworten. Versuch es bitte noch einmal.',
    retry: 'Erneut versuchen',
    loadFailed: 'Die Unterhaltung konnte nicht geladen werden.',
    sendFailed: 'Die Nachricht konnte nicht gesendet werden.',
    notAvailable: 'Der Assistent ist nicht verfügbar.',
  },
});
