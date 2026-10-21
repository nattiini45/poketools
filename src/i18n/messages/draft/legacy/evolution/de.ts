import { defineDe } from '@/i18n/define';
import { formatPack } from '@/lib/format-pack';
import type en from './en';

const P = formatPack.messages.de.draftLegacyEvolution;

export default defineDe<typeof en>()({
  xpBar: {
    ariaNamed: '{name} – Fortschritt: {value} von {max}',
    aria: 'Fortschritt: {value} von {max}',
    skip: 'Überspringen',
    skipAria: 'Animation überspringen',
  },
  decision: {
    title: 'Entscheidungsspiel nötig',
    tied: 'Diese Spieler sind nach allen Tiebreakern gleichauf (Spielpunkte, Evolutionspunkte, KO-Differenz und direkter Vergleich): <b>{names}</b>.',
    hint: 'Setz über eine manuelle Rundenpaarung ein Entscheidungsspiel an. Der Sieger löst den Gleichstand auf.',
    enter: 'Entscheidungsspiel eintragen (Admin)',
    leagueAdmin: 'Liga-Verwaltung: Phasen',
  },
  row: {
    evolved: 'Entwickelt!',
    evolvedInto: 'Entwickelt zu {form}',
    next: 'Nächste Stufe: {form}',
    nextMore: { one: 'Nächste Stufe: {form} (noch {count})', other: 'Nächste Stufe: {form} (noch {count})' },
    fullyEvolved: 'Voll entwickelt',
  },
  replay: {
    play: {
      one: 'Entwicklungs-Replay abspielen ({count} Ereignis)',
      other: 'Entwicklungs-Replay abspielen ({count} Ereignisse)',
    },
    title: 'Entwicklungs-Replay',
    skipAll: 'Alle überspringen',
    kosGained: { one: '+{count} KO', other: '+{count} KOs' },
  },
  summary: {
    evolutionPoint: 'EP: {value}',
    evolutions: { one: '{count} Entwicklung', other: '{count} Entwicklungen' },
    comebackTokens: { one: '+{count} Comeback-Token', other: '+{count} Comeback-Tokens' },
    ...P.summary,
  },
  matchup: {
    yourTrainer: 'Dein Trainer',
    opponent: 'Gegner',
    player1: 'Spieler 1',
    player2: 'Spieler 2',
    select: 'Auswählen …',
    rosters: 'Kader',
    stabTitle: 'STAB: {attacker} → {defender}',
    roleComparison: 'Teamrollen im Vergleich',
    selectTwo: 'Wähle zwei Trainer aus, um Kader, Typ-Matchups und Teamrollen zu vergleichen.',
    none: 'keine',
  },
  roster: {
    lines: { one: '{count} Linie', other: '{count} Linien' },
    progressTotal: 'Fortschritt: {n}',
    roles: 'Rollen: {list}',
    empty: 'Keine gedrafteten Linien gefunden.',
  },
  stab: {
    corner: 'vs. →',
    cellTitle: '{attacker} ({attackerTypes}) vs. {defender} ({defenderTypes})',
  },
  detail: {
    abilities: 'Fähigkeiten: {list}',
    weakTo: 'Schwach gegen',
    resists: 'Resistent gegen',
    immune: 'Immun gegen',
    teamRoles: 'Teamrollen',
  },
});
