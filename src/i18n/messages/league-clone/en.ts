/**
 * Namespace `league-clone`: the "Start from an existing league" picker on the
 * league create page. The league type label comes from `enums`.
 */
export default {
  picker: {
    label: 'Start from',
    blank: 'Blank league',
    /** One dropdown entry; `{phases}` and `{players}` are the counted texts below. */
    option: '{name} · {type} · {phases} · {players}',
    phases: { one: '{count} phase', other: '{count} phases' },
    players: { one: '{count} player', other: '{count} players' },
    archivedSuffix: 'archived',
    testSuffix: 'test',
    copiedTitle: 'Copied from the source',
    copied: {
      one: 'Settings and {count} phase (name, bracket, best-of, doubles, advancement rule, order, ruleset).',
      other: 'Settings and {count} phases (name, bracket, best-of, doubles, advancement rule, order, ruleset).',
    },
    notCopied:
      'Not copied: rounds, matches, results, the point-buy list, tokens, draft data and format rules. New phases start empty.',
    copyRoster: {
      one: 'Copy the roster ({count} player)',
      other: 'Copy the roster ({count} players)',
    },
    copyAdmins: 'Copy the league admins',
    copyAdminsHint: 'The admins of the source league can then manage the new league too.',
    datesHint: 'Dates and the name come from this form.',
    rulesetSame: 'Starts with the same rules as the source: {name}, version {version}.',
    pointBuyNote: 'A point-buy league is set up as usual: format rules and the point-buy list are not copied.',
  },
} as const;
