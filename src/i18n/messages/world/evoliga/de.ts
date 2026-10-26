import { defineDe } from '@/i18n/define';
import { formatPack } from '@/lib/format-pack';
import type en from './en';

const P = formatPack.messages.de.worldEvoliga;

// The plaza's reviewed German copy (the source wording before T19), with the
// token names and rules brought in line with the glossary and the EvoLiga spec.
export default defineDe<typeof en>()({
  points: '{points} Pkt.',
  noCompleted: 'Noch keine abgeschlossenen Spiele – die Tabelle bildet sich mit den ersten Ergebnissen.',
  pulse: {
    heading: 'Saison-Puls',
    participants: 'Teilnehmer',
    currentStage: 'Aktuelle Etappe',
    noStage: 'Noch keine Etappe angelegt',
    ruleset: 'Regelwerk',
    nextMatch: 'Nächstes Spiel',
    liveNow: 'läuft gerade',
    noOpenMatches: 'Aktuell sind keine offenen Spiele angesetzt.',
    tableTop: 'Tabellenspitze',
  },
  roster: {
    heading: 'Point-Buy-Liste',
    headingNoList: 'Kader',
    noList:
      'Für diese Liga wurde noch keine Point-Buy-Liste hinterlegt. Die Liste erscheint hier, sobald sie von der Ligaleitung gebunden wird.',
    emptyList: 'Die gebundene Point-Buy-Liste ist noch leer.',
  },
  teams: {
    heading: 'Teams',
    noParticipants: 'Für diese Liga haben sich noch keine Teilnehmer registriert.',
    noDraft:
      'Es wurden noch keine Linien gedraftet – der Draft ist für diese Liga noch nicht eingerichtet bzw. noch nicht gelaufen.',
    evolutionPoints: '<b>{points}</b> Evolutionspunkte',
    noLines: 'Keine Linien gedraftet.',
    stage: 'Stufe {stage}',
  },
  team: {
    title: 'Team: {name}',
    noLines: 'Dieser Spieler hat noch keine Linien gedraftet.',
    player: 'Spieler',
    record: 'Bilanz (S–N–U)',
    points: 'Punkte',
    rosterValue: 'Kaderwert',
    rosterValueAmount: '{value} Punkte',
    lines: 'Linien',
    totalKos: 'KOs gesamt',
    moreLines: 'Weitere Linien',
    benchStage: 'Stufe {stage}',
  },
  line: {
    title: 'Linie: {name}',
    number: 'Nr. {number}',
    line: 'Linie',
    price: 'Preis',
    priceValue: '{price} Punkte',
    priceGroup: 'Preisgruppe',
    killsToStage2: 'KOs bis Stufe 2',
    additionalKills: 'Zusätzliche KOs bis Stufe 3',
    ratings: 'Early / Mid / Late',
  },
  board: {
    pulseTitle: 'Puls – Tabelle',
    scheduleTitle: 'Spielplan',
    scheduleTitleActive: 'Spielplan – {stage}, Spieltag {round}',
    participants: { one: '{count} Teilnehmer', other: '{count} Teilnehmer' },
    liveNow: 'Läuft gerade:',
    matchdayLine: '{stage} · Spieltag {round}',
    chooseView: 'Ansicht wählen',
    tabSchedule: 'Spielplan',
    tabTable: 'Tabelle',
    tabResults: 'Ergebnisse',
    noResults: 'Noch keine Ergebnisse – der erste Spieltag ist noch nicht gespielt.',
  },
  fixtures: {
    none: 'Noch keine Spiele angesetzt.',
    disputed: 'Strittig',
  },
  standings: {
    player: 'Spieler',
    winLoss: 'S–N',
    points: 'Pkt.',
    pointsLong: 'Punkte',
    killDiff: 'KO-Diff.',
  },
  schedule: {
    heading: 'Spielplan',
    noStages: 'Für diese Liga wurden noch keine Etappen bzw. Spieltage angelegt.',
    currentTable: 'Aktuelle Tabelle',
  },
  rules: {
    heading: 'Regelwerk',
    noFormatRules:
      'Für diese Liga sind keine expliziten Formatregeln hinterlegt — es gelten die Standardregeln des Evolution-Point-Buy-Formats.',
    budgetDraft: 'Budget & Draft',
    budgetBody:
      'Jeder Spieler verfügt über ein Draft-Budget von <b>{budget} Punkten</b> und draftet <b>{picks} Entwicklungslinien</b>. Jede Linie kostet je nach Preisgruppe unterschiedlich viele Punkte; das Budget kann vollständig ausgegeben werden.',
    tokens: 'Token-Ökonomie',
    draftKillRule:
      '<b>{token}:</b> {ratio} übrige Budgetpunkte ergeben 1 Token, höchstens {max} pro Spieler und {perLine} pro Linie. Es zählt als Entwicklungsfortschritt, darf eine Entwicklung aber nie selbst auslösen.',
    evolutionTera: 'Entwicklung & Tera',
    teraStage: 'Stufe {stage}: {rule}',
    redraftHeading: 'Redraft',
    redraftBody:
      'Linien wechseln nur im Redraft zwischen Hin- und Rückrunde den Besitzer: Jeder Trainer gibt verdeckt Linien ab, danach werden die frei gewordenen Linien neu gedraftet. Trades zwischen Trainern gibt es nicht. Die Redraft-Phase ist derzeit <b>{state}</b>.',
    redraftOpen: 'geöffnet',
    redraftClosed: 'geschlossen',
    tiebreakers: 'Tiebreaker',
    tiebreakersLead: 'Bei Punktgleichheit entscheidet nacheinander:',
    tiebreaker: {
      match_points: 'Matchpunkte',
      evolution_points: 'Evolutionspunkte',
      kill_difference: 'KO-Differenz',
      head_to_head: 'Direkter Vergleich',
      decision_match: 'Entscheidungsspiel',
    },
    bans: 'Verbote',
    bannedMoves: 'Verbotene Attacken: {list}.',
    bannedItems: 'Verbotene Items: {list}.',
    none: 'keine',
    underlying: 'Zugrunde liegendes Regelwerk: <b>{name}</b>.',
    format: 'Format',
    allRules: 'Alle Regeln',
    toRulesTab: 'Zum Regeln-Tab',
    ...P.rules,
  },
  rulesPanel: {
    titleFormat: 'Regelwerk – Format',
    titleClauses: 'Regelwerk – Klauseln',
    standardRules: 'Standardregeln',
    choosePage: 'Regelseite wählen',
    tabFormat: 'Format',
    tabClauses: 'Klauseln',
    tabDraft: 'Draft',
  },
});
