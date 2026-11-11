import { defineDe } from '@/i18n/define';
import type en from './en';

/** Category and tier names render in CSS `uppercase`; they are stored in lower case as in English. */
export default defineDe<typeof en>()({
  achievements: {
    title: 'Erfolge',
    empty: 'Keine Erfolge verfügbar',
    hidden: 'Versteckter Erfolg',
    earnedTooltip: '{description} • Erhalten am {date}',
    timesEarned: '{tier} • {count}×',
    earnedCount: '{earned} von {total} Erfolgen erhalten',
    earnedOn: 'Erhalten am {date}',
    locked: 'Gesperrt',
    progress: '{current} / {target}',
    progressAria: 'Fortschritt: {current} von {target}',
    categoryNames: {
      combat: 'Kampf',
      milestone: 'Meilensteine',
      social: 'Community',
      rare: 'Selten',
      meta: 'Meta',
    },
    tierNames: {
      bronze: 'Bronze',
      silver: 'Silber',
      gold: 'Gold',
      platinum: 'Platin',
      legendary: 'Legendär',
    },
    categories: {
      combat: 'Kampf',
      milestone: 'Meilenstein',
      social: 'Community',
      rare: 'Selten',
      meta: 'Meta',
    },
    tiers: {
      bronze: 'Bronze',
      silver: 'Silber',
      gold: 'Gold',
      platinum: 'Platin',
      legendary: 'Legendär',
    },
  },
  rating: {
    provisional: 'Vorläufig',
    provisionalAria: 'Vorläufige Wertung',
    ratingTitle: '{rating} ± {rd}',
    ratingTitleProvisional: '{rating} ± {rd} (vorläufig)',
    deviation: '± {rd}',
  },
  ratingHistory: {
    empty: 'Noch kein Wertungsverlauf',
    title: 'Wertungsverlauf',
    band: 'Band = ±2×RD',
    chartAria: 'Diagramm des Wertungsverlaufs',
  },
  signatures: {
    unlockAt: { one: 'Ab {count} Partie freigeschaltet', other: 'Ab {count} Partien freigeschaltet' },
    games: { one: '{count} Partie', other: '{count} Partien' },
    locked: 'Gesperrter Platz',
  },
  streaks: {
    win: 'Siegesserie',
    ko: 'KO-Serie',
    flawless: 'Makellose Serie',
    winValue: '{n}S',
    koValue: '{n}KO',
    flawlessValue: '{n}M',
    recordsTitle: 'Serienrekorde',
    bestWin: 'Beste Siegesserie',
    bestLoss: 'Längste Niederlagenserie',
    bestKo: 'Beste KO-Serie',
    bestFlawless: 'Beste makellose Serie',
  },
});
