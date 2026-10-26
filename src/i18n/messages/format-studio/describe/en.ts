/**
 * Namespace `format-studio/describe`: the sentences of the whole-definition renderer
 * (`src/lib/format-kit/engine/describe-definition.ts`). The per-primitive sentences (pairing, series, scoring,
 * rank chain, advancement) stay in `format-studio/primitives`; this catalog holds what only the whole document
 * needs: the overview, how a stage gets its participants, the expected counts of a plan, the seeding and gate
 * words of an advancement rule, the facts of a rule card, the coverage line and the section headings.
 *
 * Count-bearing sentences are `{one, other}` forms read from a `count` param. `level.*` are the words of the
 * coverage buckets; `factValue.*` label the few string values legacy module facts carry.
 */
export default {
  overview: {
    stages: {
      one: 'One stage: {list}.',
      other: '{count} stages: {list}.',
    },
    none: 'This format has no stages yet.',
    untitled: 'Untitled format',
  },
  participants: {
    roster_rating: 'Participants come from the roster, seeded by rating.',
    roster_random: 'Participants come from the roster, seeded at random.',
    roster_manual: 'Participants come from the roster, seeded by hand.',
    roster_signup: 'Participants come from the roster, seeded in sign-up order.',
    roster_expected: {
      one: 'One participant is expected.',
      other: '{count} participants are expected.',
    },
    edges_edge_order: 'Participants come from the earlier stages, in the order they advance.',
    edges_rating: 'Participants come from the earlier stages, seeded by rating.',
    edges_random: 'Participants come from the earlier stages, seeded at random.',
    edges_manual: 'Participants come from the earlier stages, seeded by hand.',
  },
  stage: {
    doubles: 'Played as doubles.',
    players: '{count} players take part in each match.',
    ruleset_named: 'Teams follow the ruleset {name}.',
  },
  plan: {
    participants_exact: {
      one: 'Expected: {count} participant.',
      other: 'Expected: {count} participants.',
    },
    participants_range: 'Expected: {min} to {max} participants.',
    rounds: {
      one: 'Plays {count} round.',
      other: 'Plays {count} rounds.',
    },
    rounds_range: 'Plays {min} to {max} rounds.',
    bracket: 'The bracket has {size} places.',
    byes: {
      one: '{count} player gets a bye.',
      other: '{count} players get a bye.',
    },
  },
  edge: {
    line: '{rule} {seeding} {gate}',
    seeding_rank: 'Seeded by final rank.',
    seeding_cross_group: 'Seeded across the groups.',
    seeding_random: 'Seeded at random.',
    seeding_manual: 'Seeded by hand.',
    gate_admin_confirm: 'An admin confirms the result before players move on.',
    gate_auto: 'Players move on automatically.',
  },
  rule: {
    verify_admin_checklist: 'An admin checks it.',
    verify_player_attest: 'Players confirm it themselves.',
    verify_none: 'Nobody checks it.',
    when_once: 'Applies once per season.',
    when_per_match: 'Applies to every match.',
    when_per_matchday: 'Applies on every matchday.',
    visible_yes: 'Visible to players.',
    visible_no: 'Hidden from players.',
    scope_stage: 'Only in {stage}.',
  },
  coverage: {
    part: '{count} {level}',
    separator: ', ',
    line: '{parts}.',
    none: 'This format has no rules to cover yet.',
  },
  level: {
    auto: 'automated',
    checked: 'confirmed by an admin',
    honor: {
      one: 'honor rule',
      other: 'honor rules',
    },
    legacy: {
      one: 'legacy module',
      other: 'legacy modules',
    },
  },
  bool: {
    yes: 'yes',
    no: 'no',
  },
  factValue: {
    any: 'any',
    stab_only: 'only Tera types the Pokémon already has',
    none: 'not allowed',
    season: 'whole season',
    first_half: 'first half of the season',
  },
  heading: {
    stages: 'Stages',
    views: 'Combined standings',
    advancement: 'Advancement',
    rules: 'Rules',
    modules: 'Legacy modules',
    sections: 'Notes',
    coverage: 'Coverage',
  },
} as const;
