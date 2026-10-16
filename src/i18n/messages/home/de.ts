import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  hero: {
    eyebrow: 'Private Pokémon-Wettkampfliga',
    intro: 'Tabellen, Statistiken, Teams und Wiki an einem Ort – hier spielt sich die ganze Saison deiner Liga ab.',
    browseTournaments: 'Turniere ansehen',
  },
  dividerTitle: 'Schnapp sie dir alle!',
  featured: {
    league: 'Aktuelle Liga',
    tournament: 'Aktuelles Turnier',
    viewLive: 'Live ansehen',
    openInsights: 'Insights öffnen',
    standingsTop3: 'Tabelle (Top 3)',
    record: '{wins}S–{losses}N',
  },
  noActive:
    'Gerade laufen keine Ligen oder Turniere. Schau bald wieder vorbei oder stöbere unten in den abgeschlossenen Events.',
  cards: {
    insightsTitle: 'Insights',
    insightsBody: 'Wertungen, Nutzung, Kill-Ranglisten und Serien-Bestenlisten für jeden Bereich.',
    wikiTitle: 'Wiki',
    wikiBody: 'Wettkampfdaten zu Pokémon, Attacken, Items, Fähigkeiten und Tera-Typen.',
  },
  sections: {
    tournaments: 'Turniere',
    leagues: 'Ligen',
    viewAll: 'Alle ansehen',
    noTournaments: 'Noch keine Turniere.',
    noLeagues: 'Noch keine Ligen.',
  },
});
