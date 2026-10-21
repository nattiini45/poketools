/**
 * Example pack messages (English). THIS FILE IS THE CONTRACT (design spec §E.2): every pack's
 * `messages/en.ts` must have exactly these keys, placeholders, rich tags and plural shapes
 * (`definePackEn<typeof en>()`); only the texts differ. Changing a key or a placeholder here is a
 * contract change, and every pack must follow.
 *
 * Each subtree mirrors the key path of the i18n namespace it is spliced into (§E.1):
 *   worldEvoliga -> world/evoliga, draftTokens -> draft/tokens, draftRedraft -> draft/redraft,
 *   glossary -> glossary, enums -> enums, paint -> paint, draftLegacyEvolution ->
 *   draft/legacy/evolution, leagueAdminSeasonPage -> league-admin/season-page,
 *   draftShared -> draft/shared, adminCore -> admin-core, draftAdmin -> draft/admin,
 *   draftScreen -> draft/screen, worldClient -> world/client, leagueAdmin -> league-admin,
 *   leagueHub -> league-hub.
 * `utility` is not spliced: it holds one label per `epb.utility.order` key (`utilityLabel`).
 * `ruleConflicts` is not spliced either: one text per message key of the pack's `ruleChecks` hook
 * (`ruleConflictText`, shown by the point-buy import panel); its keys are the pack's own.
 *
 * The example league's rules, worded for its own numbers (src/format-packs/example/epb.ts).
 * Price groups are named by the point range of the finder tab they lie in, high to low
 * (`enums.priceGroup`, `paint.priceBand`, `worldClient.rosterTable.priceGroup`: `max–min` of the
 * containing `epb.priceTabs` entry, so guenstig and budget both read '9–1' and the UI shows them as
 * one group; pinned by src/lib/format-pack/__tests__/price-group-labels.test.ts). Direct knockouts
 * are "KOs".
 */
export default {
  worldEvoliga: {
    rules: {
      comebackRule:
        '<b>{token}:</b> a loss to nil (the loser wins no game of the match) while the winner keeps 4 or more Pokémon in total earns 1 token. Tokens are spent after the redraft and may trigger an evolution.',
      cosmoRule:
        '<b>{token}:</b> the {line} line gains 1 token for every matchday it is brought until it reaches its final stage — progress toward its evolution, never a KO.',
      evolutionBody:
        'Lines evolve through KOs plus token and participation progress. The second KO count starts again after the first evolution. Tera rules per stage:',
      /** A league's ruling on passing moves, shown under the bans (a rule for players; not enforced). */
      passRule: 'Baton Pass and Shed Tail follow the ban list above.',
    },
  },
  draftTokens: {
    dk: {
      intro:
        'Turn {cost} leftover draft points into +1 evolution progress for one of your lines: at most {max} per player, one per line. It never counts as a KO.',
    },
    cb: {
      intro:
        'Earned from a loss to nil (the loser wins no game of the match) while the winner keeps 4 or more Pokémon in total: 1 token. Unlike a Draft Kill Token, a Comeback Token can trigger an evolution.',
    },
    cosmo: {
      intro: 'Your participation line earns one Participation Token for every matchday it is brought.',
      note: 'Not KOs · this line stays locked in the redraft',
    },
  },
  draftRedraft: {
    tokenNote: 'Points spent on Draft Kill Tokens are not refunded in the redraft.',
  },
  glossary: {
    token: {
      draftKill: 'Draft Kill Token',
      comeback: 'Comeback Token',
      cosmo: 'Participation Token',
    },
    tokenCount: {
      draftKill: { one: '{count} Draft Kill Token', other: '{count} Draft Kill Tokens' },
      comeback: { one: '{count} Comeback Token', other: '{count} Comeback Tokens' },
      cosmo: { one: '{count} Participation Token', other: '{count} Participation Tokens' },
    },
  },
  enums: {
    priceGroup: { premium: '25–20', hoch: '19–15', mittel: '14–10', guenstig: '9–1', budget: '9–1' },
  },
  paint: {
    gate: {
      label: {
        cosmoPoints: 'Participation',
      },
      value: {
        shutout: 'Loss to nil, winner 4+ alive → 1 token',
        participation: 'Brought → progress',
      },
    },
    priceBand: {
      premium: '25–20',
      hoch: '19–15',
      mittel: '14–10',
      guenstig: '9–1',
      budget: '9–1',
    },
  },
  draftLegacyEvolution: {
    summary: {
      suspendedNext: 'Sits out the next matchday',
      suspensionDetail: '{name} sits out the next matchday (final stage reached early)',
    },
  },
  leagueAdminSeasonPage: {
    typeCores: {
      subtitle: 'Curate a pool of type triples, then assign them manually or bulk-randomize.',
    },
  },
  draftShared: {
    progress: {
      cosmoChip: '+{n} Participation',
    },
    reasons: {
      COSMOG_REDRAFT_LOCKED: 'The participation line cannot be redrafted.',
    },
  },
  adminCore: {
    actions: {
      dialogs: {
        resetMessage: {
          one: 'This will delete all {count} game and their stats, clean match prep/proposal/broadcast data, and RECALCULATE standings, Pokémon records, ratings, and (for Evolution League) evolution progress, Evolution Points, Participation Tokens, and Kill Tokens from the remaining matches. If any later matches become inconsistent, they will be flagged. This cannot be undone.',
          other: 'This will delete all {count} games and their stats, clean match prep/proposal/broadcast data, and RECALCULATE standings, Pokémon records, ratings, and (for Evolution League) evolution progress, Evolution Points, Participation Tokens, and Kill Tokens from the remaining matches. If any later matches become inconsistent, they will be flagged. This cannot be undone.',
        },
      },
    },
  },
  draftAdmin: {
    tokens: {
      col: {
        cosmo: 'Participation',
      },
    },
  },
  draftScreen: {
    info: {
      cosmogLine: 'Participation Token line',
    },
  },
  worldClient: {
    rosterTable: {
      priceGroup: {
        premium: '25–20',
        hoch: '19–15',
        mittel: '14–10',
        guenstig: '9–1',
        budget: '9–1',
      },
    },
  },
  leagueAdmin: {
    form: {
      leagueTypeLabel: 'Evolution Point Buy',
      battleRulesetName: 'Evolution Point Buy',
    },
  },
  leagueHub: {
    seasonEvolutionScoring: '3 points per win, 1 per draw · KO difference, then evolution points break ties.',
    evolutionScoring: '3 points per win, 1 per draw · KO difference, then evolution points, then head-to-head',
  },
  /** Texts of the `epb.reconciliation.ruleChecks` hook's conflicts (pack-own keys); the example pack has no hook. */
  ruleConflicts: {},
  utility: {
    hazards: 'Hazards',
    hazard_control: 'Hazard control',
    recovery: 'Recovery',
    pivot: 'Pivoting',
    priority: 'Priority',
  },
} as const;
