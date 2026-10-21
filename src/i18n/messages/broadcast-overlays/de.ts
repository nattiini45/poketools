import { defineDe } from '@/i18n/define';
import type en from './en';

export default defineDe<typeof en>()({
  common: {
    vs: 'VS',
    vsLower: 'vs.',
    winner: 'Sieger',
    bestOf: 'Best of {count}',
    record: '{wins}S–{losses}N',
    winsShort: 'S',
    lossesShort: 'N',
    unknownPlayer: 'Unbekannt',
    myTeam: 'Mein Team',
    me: 'Ich',
    opponent: 'Gegner',
    game: 'Partie {n}',
    gameWinner: '{name} gewinnt Partie {n}',
    alive: '{count} übrig',
    kos: { one: '{count} KO', other: '{count} KOs' },
    games: { one: '{count} Partie', other: '{count} Partien' },
    winRate: '{rate} Siege',
    mvpBadge: '★ MVP',
    draw: 'Unentschieden',
    league: 'Liga',
  },
  streak: {
    win: { one: '{count} Sieg in Folge', other: '{count} Siege in Folge' },
    flawless: { one: '{count} makelloser Sieg in Folge', other: '{count} makellose Siege in Folge' },
    ko: { one: '{count} KO in Folge', other: '{count} KOs in Folge' },
  },
  moment: {
    turning_point: 'Wendepunkt',
    big_ko: 'Wichtiger KO',
    misplay: 'Misplay',
    clutch: 'Clutch',
    highlight: 'Highlight',
    turn: 'Zug {n}',
  },
  statCard: {
    turns: '{count} Z.',
    notUsed: 'Nicht eingesetzt',
    lead: 'Lead',
    koed: 'KO',
  },
  matchCard: {
    mvp: { one: 'MVP: {pokemon} ({count} KO, {player})', other: 'MVP: {pokemon} ({count} KOs, {player})' },
  },
  rating: {
    peak: 'Bestwert',
    peakValue: '(Bestwert: {rating})',
  },
  score: {
    series: 'Serie {p1}–{p2}',
  },
  reel: {
    empty: 'Keine Momente erfasst',
    title: 'Spiel-Highlights · {current}/{total}',
  },
  standings: {
    title: 'Tabelle',
    points: '{points} Pkt.',
    tickerEntry: '#{rank} {name} {wins}–{losses}',
    tickerEntryWithPokemon: '#{rank} {name} {wins}–{losses} ({pokemon})',
  },
  preview: {
    h2h: 'Direkter Vergleich: {p1}–{p2}',
    leads: '{name} führt',
    even: 'Ausgeglichen',
  },
  results: {
    reveal: 'Klicke, um das Ergebnis aufzudecken',
    notCompleted: 'Spiel noch nicht beendet',
  },
  story: {
    matchMvp: 'MVP des Spiels',
  },
  teams: {
    title: 'Teamvergleich',
  },
  usage: {
    title: 'Pokémon-Nutzung',
  },
  h2h: {
    title: 'Direkter Vergleich',
    matches: { one: '{count} Spiel', other: '{count} Spiele' },
    firstMeeting: 'Erstes Aufeinandertreffen',
    history: 'Bisherige Duelle',
  },
  spotlight: {
    signature: 'Signature-Pokémon',
  },
  leaders: {
    title: 'Bestwerte der Saison',
    mostKos: 'Meiste KOs',
    pokemonMvp: 'Pokémon-MVP',
    bestRecord: 'Beste Bilanz',
    kosValue: '{pokemon} ({kos})',
    winRateValue: '{pokemon} ({rate} Siege)',
    recordValue: '{name} ({wins}–{losses})',
    none: 'Noch keine Bestwerte',
    notEnough: 'Noch nicht genug Daten für die Bestwerte der Saison',
  },
  attract: {
    tagline: 'Kompetitive Pokémon-Liga',
    currentStandings: 'Aktuelle Tabelle',
    inProgress: 'Spiele laufen noch',
    recentResults: 'Letzte Ergebnisse',
  },
  recap: {
    title: 'Rückblick: {round}',
    roundFallback: 'Runde {n}',
    matchOfRound: 'Spiel der Runde',
    results: 'Ergebnisse dieser Runde',
    movement: 'Bewegung in der Tabelle',
    noMovement: 'Keine großen Tabellenänderungen in dieser Runde',
    story: 'Die Geschichte der Saison',
    noStory: 'Hier erscheint der Rückblick auf die Runde',
  },
  wiki: {
    power: 'Stärke',
    accuracy: 'Genauigkeit',
    pp: 'AP',
    priority: 'Priorität',
    teraType: 'Tera-Typ',
  },
});
