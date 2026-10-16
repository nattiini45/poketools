import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  security: {
    title: 'Anmeldemethoden',
    intro: 'Verknüpfe beide, dann kannst du dich auf beiden Wegen anmelden – derselbe Spieler, dieselben Teams und Statistiken.',
    discord: 'Discord',
    linked: 'Verknüpft',
    notLinked: 'Nicht verknüpft',
    linkDiscord: 'Discord verknüpfen',
    emailPassword: 'E-Mail & Passwort',
    unconfirmed: '{email} (unbestätigt – schau in dein Postfach)',
    addEmail: 'E-Mail-Anmeldung hinzufügen',
    email: 'E-Mail',
    password: 'Passwort',
    passwordHint: 'Mindestens 8 Zeichen.',
    confirmPassword: 'Passwort bestätigen',
    passwordsMismatch: 'Die Passwörter stimmen nicht überein.',
    linkEmail: 'E-Mail-Anmeldung verknüpfen',
    cancel: 'Abbrechen',
    emailLinked:
      'E-Mail-Anmeldung hinzugefügt. Bestätige die Adresse über den Link in deinem Postfach, bevor du dich damit anmeldest.',
    loadFailed: 'Die verknüpften Konten konnten nicht geladen werden.',
    linkEmailFailed: 'Die E-Mail-Anmeldung konnte nicht verknüpft werden. Bitte versuche es noch einmal.',
    linkDiscordFailed: 'Die Discord-Verknüpfung konnte nicht gestartet werden. Bitte versuche es noch einmal.',
  },
  agentSettings: {
    title: 'KI-Assistent',
    badge: 'KI',
    intro:
      'Wähle deinen Standard-Assistenten und die Reihenfolge, in der die Modelle probiert werden. Weiter oben stehende Modelle laufen zuerst; ist eins nicht verfügbar, geht der Assistent die Liste weiter nach unten.',
    loading: 'Deine Einstellungen werden geladen …',
    defaultAssistant: 'Standard-Assistent',
    modelPriority: 'Modell-Reihenfolge',
    moveUp: '{model} nach oben',
    moveDown: '{model} nach unten',
    save: 'KI-Einstellungen speichern',
    saved: 'KI-Einstellungen gespeichert.',
    loadFailed: 'Deine KI-Einstellungen konnten nicht geladen werden.',
    saveFailed: 'Die Einstellungen konnten nicht gespeichert werden.',
    personas: {
      linden_teambuilding: 'Professor Linden – Teambuilding',
      linden_match_prep: 'Professor Linden – Spielvorbereitung',
      kale: 'Kale – Turnierberichte (Admin)',
    },
  },
  usernames: {
    title: 'Spielernamen',
    edit: 'Bearbeiten',
    intro: 'Lege deine Namen für Pokémon Showdown und Pokémon Champions fest, damit sie in deinem Profil stehen.',
    showdown: 'Pokémon-Showdown-Name',
    showdownPlaceholder: 'Deinen PS-Namen eingeben',
    champions: 'Pokémon-Champions-Name',
    championsPlaceholder: 'Deinen Champions-Namen eingeben',
    save: 'Namen speichern',
    saved: 'Namen gespeichert!',
    failed: 'Die Namen konnten nicht gespeichert werden.',
  },
  worldExperience: {
    title: '3D-Welten',
    intro: 'Lege fest, ob Ligaseiten für dich ihre 3D-Routenwelten anzeigen.',
    staleRead:
      'Deine gespeicherte Einstellung konnte nicht geladen werden, deshalb ist „{option}“ als Ersatz vorausgewählt – das muss nicht der gespeicherte Wert sein. Beim Speichern wird die gespeicherte Einstellung durch deine Auswahl ersetzt.',
    legend: 'Routenwelten',
    save: 'Einstellung speichern',
    saved: '3D-Einstellung gespeichert.',
    saveFailed: 'Deine 3D-Einstellung konnte nicht gespeichert werden.',
    saveFailedRetry: 'Deine 3D-Einstellung konnte nicht gespeichert werden. Bitte versuche es noch einmal.',
    options: {
      auto: {
        label: 'Automatisch',
        help: 'PokéTools entscheidet anhand deines Geräts, deiner Verbindung und deiner Bewegungseinstellungen.',
      },
      on: {
        label: 'Immer an',
        help: 'Ignoriert Datensparmodus und Energiesparerkennung. Bei reduzierter Bewegung und auf Geräten ohne WebGL bleibt es trotzdem bei der einfachen Version.',
      },
      off: {
        label: 'Immer aus (Standard)',
        help: 'Lädt die 3D-Welten nie und zeigt immer die einfache Version.',
      },
    },
  },
});
