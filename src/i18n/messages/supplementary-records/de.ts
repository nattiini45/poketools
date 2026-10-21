import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  title: 'Frühere Ergebnisse',
  note: 'Ergebnisse, die außerhalb dieser Seite erfasst wurden. Sie zählen nicht zu den Live-Statistiken oben.',
  loadFailed: 'Die früheren Ergebnisse konnten gerade nicht geladen werden.',
  profile: {
    record: '{wins} S · {draws} U · {losses} N',
    played: {
      one: '{count} Spiel',
      other: '{count} Spiele',
    },
    titles: {
      one: '{count} Titel',
      other: '{count} Titel',
    },
    runnerUps: {
      one: '{count} zweiter Platz',
      other: '{count} zweite Plätze',
    },
  },
  headToHead: {
    record: 'Frühere Ergebnisse: {wins} S · {draws} U · {losses} N',
  },
  pokemon: {
    kos: {
      one: 'Frühere Ergebnisse: {count} KO',
      other: 'Frühere Ergebnisse: {count} KOs',
    },
  },
});
