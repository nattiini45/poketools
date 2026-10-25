import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  picker: {
    label: 'Starten mit',
    blank: 'Leere Liga',
    option: '{name} · {type} · {phases} · {players}',
    phases: { one: '{count} Phase', other: '{count} Phasen' },
    players: { one: '{count} Spieler', other: '{count} Spieler' },
    archivedSuffix: 'archiviert',
    testSuffix: 'Test',
    copiedTitle: 'Wird aus der Vorlage übernommen',
    copied: {
      one: 'Einstellungen und {count} Phase (Name, Turniermodus, Best-of, Doppel, Regel fürs Weiterkommen, Reihenfolge, Regelwerk).',
      other: 'Einstellungen und {count} Phasen (Name, Turniermodus, Best-of, Doppel, Regel fürs Weiterkommen, Reihenfolge, Regelwerk).',
    },
    notCopied:
      'Nicht übernommen: Runden, Spiele, Ergebnisse, die Point-Buy-Liste, Token, Draft-Daten und Formatregeln. Neue Phasen starten leer.',
    copyRoster: {
      one: 'Kader übernehmen ({count} Spieler)',
      other: 'Kader übernehmen ({count} Spieler)',
    },
    copyAdmins: 'Liga-Admins übernehmen',
    copyAdminsHint: 'Die Admins der Vorlage können dann auch die neue Liga verwalten.',
    datesHint: 'Datum und Name kommen aus diesem Formular.',
    pointBuyNote:
      'Eine Point-Buy-Liga wird wie gewohnt eingerichtet: Formatregeln und die Point-Buy-Liste werden nicht übernommen.',
  },
});
