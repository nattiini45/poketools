import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  page: {
    title: 'Testspieler',
    subtitle:
      '14 isolierte Dummy-Konten für Entwicklung und Admin-Tests (aus allen öffentlichen und globalen Daten ausgeschlossen)',
    back: 'Admin',
  },

  standard: {
    title: 'Standard-Testspieler',
    intro:
      'Beim Erstellen wird sichergestellt, dass genau 14 Dummy-Konten (EvoTest01–EvoTest14) existieren. Sie sind mit <code>is_test_account</code> markiert und von jeder öffentlichen und globalen Ansicht ausgeschlossen. Idempotent – du kannst es beliebig oft ausführen.',
    ensure: '14 Testspieler erstellen / reparieren',
    refresh: 'Aktualisieren',
    loading: 'Testkonten werden geladen …',
    empty: 'Noch keine Testkonten. Klicke auf <strong>Erstellen / reparieren</strong>, um die 14 Standardkonten anzulegen.',
    tableEmpty: 'Keine Testkonten',
    mintedNote: 'Wird nur einmal angezeigt – speichere es, bevor du die Seite verlässt. Setze es jederzeit mit „Login zurücksetzen“ zurück.',
  },

  table: {
    name: 'Name',
    psUsername: 'PS-Benutzername',
    login: 'Login',
    actions: 'Aktionen',
    testBadge: 'Test',
    loginEnabled: 'aktiviert',
    loginDisabled: 'deaktiviert',
  },

  actions: {
    reset: 'Daten zurücksetzen',
    mintLogin: 'Login erzeugen',
    resetLogin: 'Login zurücksetzen',
    clearLogin: 'Login entfernen',
    removeFromSeason: 'Aus Saison entfernen',
    removeFromSeasonLabel: 'Aus Saison entfernen: {name}',
    removeFromSeasonHint: 'Gib unten eine Saison-UUID ein, um dies zu aktivieren',
  },

  season: {
    title: 'Testdaten auf Saison-Ebene',
    intro:
      'Gib eine Saison-UUID ein und nutze dann <strong>Aus Saison entfernen</strong> in einer Spielerzeile oben (löscht Teilnahme und Saisonfortschritt dieses Spielers) oder lösche jedes Match der Saison, bei dem <strong>beide</strong> Teilnehmer Testkonten sind.',
    idLabel: 'Saison-UUID',
    deleteMatches: 'Nur-Test-Matches löschen',
  },

  // Bestätigungsdialoge der zerstörenden Aktionen (gemeinsamer ConfirmDialog).
  confirm: {
    reset: {
      title: 'Daten zurücksetzen?',
      message:
        'Dadurch werden Evolutionsfortschritt, Token-Vergaben und Match-Evolutions-Snapshots von {name} in allen Saisons gelöscht. Das Konto und seine Matches bleiben bestehen. Das lässt sich nicht rückgängig machen.',
      confirm: 'Daten zurücksetzen',
    },
    replaceLogin: {
      title: 'Login zurücksetzen?',
      message:
        '{name} hat bereits einen Login. Dadurch wird das Passwort durch ein neues ersetzt, und das alte funktioniert sofort nicht mehr. Die neuen Zugangsdaten werden einmalig angezeigt.',
      confirm: 'Login zurücksetzen',
    },
    clearLogin: {
      title: 'Login entfernen?',
      message:
        'Dadurch wird der Login von {name} gelöscht. Eine Anmeldung ist erst wieder möglich, wenn du einen neuen Login erzeugst.',
      confirm: 'Login entfernen',
    },
    removeFromSeason: {
      title: 'Aus Saison entfernen?',
      message:
        'Dadurch wird {name} aus Saison {season} entfernt: Teilnahme, Saisonfortschritt und Token-Vergaben in dieser Saison werden gelöscht. Historische Match-Snapshots bleiben erhalten. Das lässt sich nicht rückgängig machen.',
      confirm: 'Aus Saison entfernen',
    },
    deleteMatches: {
      title: 'Nur-Test-Matches löschen?',
      message:
        'Dadurch wird jedes Match in Saison {season} gelöscht, bei dem beide Teilnehmer Testkonten sind, samt Spielen, Kampfstatistiken und Analysen. Matches mit echten Spielern bleiben unberührt. Das lässt sich nicht rückgängig machen.',
      confirm: 'Matches löschen',
    },
  },

  notice: {
    ensured: {
      one: '{count} Standard-Testspieler sichergestellt.',
      other: '{count} Standard-Testspieler sichergestellt.',
    },
    minted: 'Login-Daten für {name} erzeugt.',
    done: {
      reset: 'Daten zurückgesetzt – für {name} erledigt.',
      mint_login: 'Login erzeugt – für {name} erledigt.',
      clear_login: 'Login entfernt – für {name} erledigt.',
    },
    removed: '{name} aus Saison {season} entfernt.',
    deleted: {
      one: '{count} Nur-Test-Match in Saison {season} gelöscht.',
      other: '{count} Nur-Test-Matches in Saison {season} gelöscht.',
    },
  },

  error: {
    network: 'Netzwerkfehler',
    loadFailed: 'Die Testkonten konnten nicht geladen werden',
    ensureFailed: 'Die Testspieler konnten nicht sichergestellt werden',
    failed: {
      reset: 'Das Zurücksetzen der Daten ist fehlgeschlagen',
      mint_login: 'Das Erzeugen des Logins ist fehlgeschlagen',
      clear_login: 'Das Entfernen des Logins ist fehlgeschlagen',
    },
    removeFailed: 'Das Entfernen aus der Saison ist fehlgeschlagen',
    deleteMatchesFailed: 'Das Löschen der Test-Matches ist fehlgeschlagen',
    seasonRequiredRemove: 'Gib die UUID der Saison ein, aus der der Spieler entfernt werden soll',
    seasonRequiredDelete: 'Gib die UUID der Saison ein, deren Nur-Test-Matches gelöscht werden sollen',
    noPlayers: 'Keine Testspieler vorhanden',
  },
});
