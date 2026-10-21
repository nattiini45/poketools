import { defineDe } from '@/i18n/define';
import { formatPack } from '@/lib/format-pack';
import type en from './en';

const P = formatPack.messages.de.glossary;

// The "de" column of i18n-core §10.3.
export default defineDe<typeof en>()({
  draft: {
    draft: 'Draft',
    draftRoom: 'Draft-Raum',
    liveDraft: 'Live-Draft',
    slowDraft: 'Slow-Draft',
    initialDraft: 'Initial-Draft',
    redraft: 'Redraft',
    secretDrop: 'Verdeckte Abgabe',
    submissionPhase: 'Abgabephase',
    pick: 'Pick',
    makeupPick: 'Nachhol-Pick',
    snakeOrder: 'Snake-Reihenfolge',
    youOnClock: 'Du bist am Zug',
    playerOnClock: '{name} ist am Zug',
    youNext: 'Du bist als Nächstes dran',
    paused: 'Draft pausiert',
    quietHours: 'Ruhezeit',
    draftCta: 'Draften',
    confirmPick: 'Pick bestätigen',
    timeLeft: 'Restzeit',
    extension: 'Verlängerung',
    timeExpired: 'Zeit abgelaufen',
    deadline: 'Frist',
    adminOverride: 'Admin-Eingriff',
    auditTrail: 'Protokoll',
  },
  roster: {
    roster: 'Kader',
    rosterSlot: 'Kaderplatz',
    line: 'Linie',
    base: 'Basis',
    stage2: 'Stufe 2',
    stage3: 'Stufe 3',
  },
  price: {
    price: 'Preis',
    budget: 'Budget',
    remainingAfterPick: 'Restbudget nach dem Pick',
    points: 'Punkte',
  },
  state: {
    notDraftable: 'Nicht draftbar',
    draftedBy: 'Gedraftet von {name}',
    showDrafted: 'Gedraftete anzeigen',
    favourites: 'Favoriten',
    compare: 'Vergleichen',
    filters: 'Filter',
    all: 'Alle',
  },
  ...P,
  progress: {
    selfEarnedKills: 'KOs',
    transferred: 'übertragen',
    progress: 'Fortschritt',
    evolutionProgress: 'Entwicklungsfortschritt',
    evolutionPoints: 'Evolutionspunkte',
    evolutionPointsShort: 'EP',
    realKills: 'KOs',
  },
  league: {
    matchday: 'Spieltag',
    season: 'Saison',
    league: 'Liga',
    tournament: 'Turnier',
  },
});
