import { defineDe } from '@/i18n/define';
import type en from './en';

/**
 * German for `format-studio/describe`. New copy without a native review: neutral statements, the glossary of
 * `docs/i18n.md` (Stage, Phase, Tabelle, Freilos, K.-o.-System); the plural objects follow the English ones.
 */
export default defineDe<typeof en>()({
  overview: {
    stages: {
      one: 'Eine Stage: {list}.',
      other: '{count} Stages: {list}.',
    },
    none: 'Dieses Format hat noch keine Stages.',
    untitled: 'Format ohne Titel',
  },
  participants: {
    roster_rating: 'Die Teilnehmer kommen aus der Teilnehmerliste, gesetzt nach Rating.',
    roster_random: 'Die Teilnehmer kommen aus der Teilnehmerliste, gesetzt nach Zufall.',
    roster_manual: 'Die Teilnehmer kommen aus der Teilnehmerliste, von Hand gesetzt.',
    roster_signup: 'Die Teilnehmer kommen aus der Teilnehmerliste, gesetzt nach Anmeldereihenfolge.',
    roster_expected: {
      one: 'Erwartet wird ein Teilnehmer.',
      other: 'Erwartet werden {count} Teilnehmer.',
    },
    edges_edge_order: 'Die Teilnehmer kommen aus den früheren Stages, in der Reihenfolge des Weiterkommens.',
    edges_rating: 'Die Teilnehmer kommen aus den früheren Stages, gesetzt nach Rating.',
    edges_random: 'Die Teilnehmer kommen aus den früheren Stages, gesetzt nach Zufall.',
    edges_manual: 'Die Teilnehmer kommen aus den früheren Stages, von Hand gesetzt.',
  },
  stage: {
    doubles: 'Wird als Doppel gespielt.',
    players: 'An jedem Spiel nehmen {count} Spieler teil.',
    ruleset_named: 'Die Teams folgen dem Regelwerk {name}.',
  },
  plan: {
    participants_exact: {
      one: 'Erwartet: {count} Teilnehmer.',
      other: 'Erwartet: {count} Teilnehmer.',
    },
    participants_range: 'Erwartet: {min} bis {max} Teilnehmer.',
    rounds: {
      one: 'Gespielt wird {count} Runde.',
      other: 'Gespielt werden {count} Runden.',
    },
    rounds_range: 'Gespielt werden {min} bis {max} Runden.',
    bracket: 'Der Turnierbaum hat {size} Plätze.',
    byes: {
      one: '{count} Spieler erhält ein Freilos.',
      other: '{count} Spieler erhalten ein Freilos.',
    },
  },
  edge: {
    line: '{rule} {seeding} {gate}',
    seeding_rank: 'Gesetzt wird nach der Endplatzierung.',
    seeding_cross_group: 'Gesetzt wird über die Gruppen hinweg.',
    seeding_random: 'Gesetzt wird nach Zufall.',
    seeding_manual: 'Gesetzt wird von Hand.',
    gate_admin_confirm: 'Ein Admin bestätigt das Ergebnis, bevor die Spieler weiterkommen.',
    gate_auto: 'Die Spieler kommen automatisch weiter.',
  },
  rule: {
    verify_admin_checklist: 'Ein Admin prüft sie.',
    verify_player_attest: 'Die Spieler bestätigen sie selbst.',
    verify_none: 'Niemand prüft sie.',
    when_once: 'Gilt einmal pro Saison.',
    when_per_match: 'Gilt für jedes Spiel.',
    when_per_matchday: 'Gilt an jedem Spieltag.',
    visible_yes: 'Für Spieler sichtbar.',
    visible_no: 'Für Spieler nicht sichtbar.',
    scope_stage: 'Nur in {stage}.',
  },
  coverage: {
    part: '{count} {level}',
    separator: ', ',
    line: '{parts}.',
    none: 'Dieses Format hat noch keine Regeln, die sich abdecken lassen.',
  },
  level: {
    auto: 'automatisch',
    checked: 'vom Admin bestätigt',
    honor: {
      one: 'Vertrauensregel',
      other: 'Vertrauensregeln',
    },
    legacy: {
      one: 'Legacy-Modul',
      other: 'Legacy-Module',
    },
  },
  bool: {
    yes: 'ja',
    no: 'nein',
  },
  factValue: {
    any: 'beliebig',
    stab_only: 'nur Tera-Typen, die das Pokémon bereits hat',
    none: 'nicht erlaubt',
    season: 'ganze Saison',
    first_half: 'erste Saisonhälfte',
  },
  heading: {
    stages: 'Stages',
    views: 'Gesamttabellen',
    advancement: 'Weiterkommen',
    rules: 'Regeln',
    modules: 'Legacy-Module',
    sections: 'Hinweise',
    coverage: 'Abdeckung',
  },
});
