import { defineDe } from '@/i18n/define';
import { formatPack } from '@/lib/format-pack';
import type en from './en';

const P = formatPack.messages.de.paint;

/**
 * The plaza's reviewed German canvas words (wave 2 fidelity rounds), stored in
 * sentence case; `paintCaps` turns them back into the painted capitals
 * ("Nächster Anpfiff" → "NÄCHSTER ANPFIFF").
 */
export default defineDe<typeof en>()({
  common: {
    live: 'Live',
    points: '{points} Pkt',
    matchday: 'Spieltag',
    matchdayN: 'Spieltag {n}',
  },
  board: {
    pulseTitle: 'Puls',
    tableTitle: 'Tabelle',
    resultsTitle: 'Ergebnisse',
    scheduleTitle: 'Spielplan',
    noLiveMatch: 'Kein Spiel im Gange',
    gamesPlayed: { one: '{count} Spiel gespielt', other: '{count} Spiele gespielt' },
    participants: { one: '{count} Teilnehmer', other: '{count} Teilnehmer' },
    colWins: 'S',
    colLosses: 'N',
    colDraws: 'U',
    colDiff: 'Diff',
    colPoints: 'Pkt',
    emptyTableHeadline: 'Noch keine Tabelle',
    emptyTableCopy: 'Sie bildet sich mit den ersten Ergebnissen.',
    emptyResultsHeadline: 'Noch keine Ergebnisse',
    emptyResultsCopy: 'Der erste Spieltag ist noch nicht gespielt.',
    emptyScheduleHeadline: 'Kein Spieltag angesetzt',
    emptyScheduleCopy: 'Die nächsten Spiele werden gerade angesetzt.',
    groupCurrent: 'Aktuell',
    groupNext: 'Danach',
    groupLabel: '{matchday} · {tag}',
    groupLabelMore: '{matchday} · {tag} · +{count} weitere',
    status: {
      upcoming: 'Offen',
      live: 'Läuft',
      done: 'Beendet',
    },
    kickoffNext: 'Nächster Anpfiff · {date} {time} Uhr',
    countdown: 'Nächster Anpfiff in {clock} · {date} {time} Uhr',
    countdownDays: { one: '{count} T {clock}', other: '{count} T {clock}' },
    liveTicker: 'Läuft · {home} — {away}',
  },
  desk: {
    kioskBrand: 'Rotom-PC · EvoLiga',
    rosterTitle: 'Kaderliste',
    lines: { one: '{count} Linie', other: '{count} Linien' },
    open: { one: '{count} frei', other: '{count} frei' },
    columns: 'Linie · Pokémon · Preis',
    price: '{price} Pkt',
    holoBrand: 'EvoLiga · Kader',
    healing: 'Heilung',
  },
  gate: {
    teraRule: {
      any: 'Freies Tera',
      stab_only: 'Nur STAB-Tera',
      none: 'Kein Tera',
    },
    tiebreaker: {
      match_points: 'Matchpunkte',
      evolution_points: 'Entwicklungspunkte',
      kill_difference: 'Kill-Differenz',
      head_to_head: 'Direkter Vergleich',
      decision_match: 'Entscheidungsspiel',
    },
    none: 'keine',
    rulesTabText: 'im Regeln-Tab',
    rulesTabNote: 'Klauseln, Verbote und eigene Regeln dieser Liga stehen in der Liga-Übersicht.',
    rulesNoneText: 'nicht hinterlegt',
    rulesNoneNote: '{noRuleset} Klauseln, Verbote und eigene Regeln sind nicht hinterlegt.',
    label: {
      ruleset: 'Regelwerk',
      format: 'Format',
      bestOf: 'Best-of',
      clauses: 'Klauseln',
      bans: 'Verbote',
      customRules: 'Eigene Regeln',
      draftBudget: 'Draft-Budget',
      evolutionLines: 'Entwicklungslinien',
      redraftPhase: 'Redraft-Phase',
      teraStage: 'Tera — Stufe {n}',
      bannedMoves: 'Verbotene Attacken',
      bannedItems: 'Verbotene Items',
      draftTokens: 'Drafttoken',
      tokensPerPlayer: 'Token je Spieler',
      tokensPerLine: 'Token je Linie',
      killTokens: 'Killtoken',
      ...P.gate.label,
    },
    value: {
      budgetPoints: '{budget} Punkte',
      open: 'geöffnet',
      closed: 'geschlossen',
      tokenRatio: '{ratio} Punkte → 1 Token',
      max: 'max. {n}',
      ...P.gate.value,
    },
    note: {
      tiebreaker: 'Tiebreaker: {chain}',
      banned: 'Attacken: {moves} · Items: {items}',
    },
    heading: {
      format: 'Format',
      clauses: 'Klauseln',
      draftRules: 'Draft-Regeln',
    },
    plaque: {
      kickerLeft: 'Tafel I',
      kickerRight: 'Tafel II',
      titleFormat: 'Format',
      titleClausesBans: 'Klauseln & Verbote',
      titleFormatDraft: 'Format & Draft',
      titleTeraClauses: 'Tera & Klauseln',
      footer: 'Antippen für das ganze Regelwerk',
      boardKicker: 'Regelwerk',
    },
    cta: {
      draft: 'Jetzt draften',
      play: 'Jetzt antreten',
    },
  },
  crest: {
    kicker: 'Trainer {index}/{total}',
    kickerPlace: 'Trainer {index}/{total} · Platz {place}',
    ace: 'Ass · {ace}',
    tagline: 'Deine Arena. Dein Glanz.',
  },
  ledger: {
    kicker: 'Trainer',
    rankSpan: 'Platz 1–{n}',
    setBack: 'hinten',
    height: '{height} m',
  },
  plinth: {
    kicker: 'Ass',
  },
  kiosk: {
    pulseTable: 'Puls · Tabelle',
    rosterWest: 'Kaderliste ← West',
    rulesSouth: 'Regeln ↓ Süd',
  },
  priceBand: P.priceBand,
  rosterNote: {
    tapWall: 'Tippe für alle {total} Linien',
    tapWallCounted: '{shown} von {total} · Tippe für alle {total} Linien',
    tapSail: 'Tippe für alle {total} Linien',
    tapSailCounted: '{shown} von {total} · Tippe für alle {total} Linien',
  },
});
