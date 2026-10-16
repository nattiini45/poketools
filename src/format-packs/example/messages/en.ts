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
 *   draftScreen -> draft/screen, worldClient -> world/client, leagueHub -> league-hub.
 * `utility` is not spliced: it holds one label per `epb.utility.order` key (`utilityLabel`).
 *
 * The example league's rules, worded for its own numbers (src/format-packs/example/epb.ts).
 */
export default {
  worldEvoliga: {
    rules: {
      comebackRule:
        '<b>{token}:</b> losing without a single KO while the winner keeps four or more Pokémon earns 1 token. Tokens are spent after the redraft and may trigger an evolution.',
      cosmoRule:
        '<b>{token}:</b> the {line} line gains 1 token for every matchday it is brought until it reaches its final stage — progress toward its evolution, never a kill.',
      evolutionBody:
        'Lines evolve through real kills plus token and participation progress. The second kill count starts again after the first evolution. Tera rules per stage:',
    },
  },
  draftTokens: {
    dk: {
      intro:
        'Turn {cost} leftover draft points into +1 evolution progress for one of your lines: at most {max} per player, one per line. It never counts as a KO.',
    },
    cb: {
      intro:
        'Earned by a loss without a single KO when the winner keeps four or more Pokémon: 1 token. Unlike a Draft Kill Token, a Comeback Token can trigger an evolution.',
    },
    cosmo: {
      intro: 'Your participation line earns one Participation Token for every matchday it is brought.',
      note: 'Not real KOs · this line stays locked in the redraft',
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
    priceGroup: { premium: 'Top', hoch: 'Upper', mittel: 'Middle', guenstig: 'Lower', budget: 'Bargain' },
  },
  paint: {
    gate: {
      label: {
        cosmoPoints: 'Participation',
      },
      value: {
        shutout: 'Clean loss, winner 4+ alive → 1 token',
        participation: 'Brought → progress',
      },
    },
    priceBand: {
      premium: 'Top',
      hoch: 'Upper',
      mittel: 'Middle',
      guenstig: 'Lower',
      budget: 'Bargain',
    },
  },
  draftLegacyEvolution: {
    summary: {
      suspendedNext: 'Sits out the next matchday',
      suspensionDetail: '{name} sits out the next matchday (final stage reached early)',
    },
    pointBuy: {
      rule: {
        noCocoon: 'Full middle stage ({base})',
        cosmog: 'Participation Tokens, {s2}/{s3} progress points, locked in the redraft',
      },
      ruleFilter: {
        scatterbug: '{species}: instant final stage',
        no_cocoon_rule: 'Full middle stage',
      },
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
        premium: 'Top (20–25)',
        hoch: 'Upper (15–19)',
        mittel: 'Middle (10–14)',
        guenstig: 'Lower (6–9)',
        budget: 'Bargain (1–5)',
      },
    },
  },
  leagueHub: {
    seasonEvolutionScoring: '3 points per win, 1 per draw · kill difference, then evolution points break ties.',
    evolutionScoring: '3 points per win, 1 per draw · kill difference, then evolution points, then head-to-head',
  },
  utility: {
    hazards: 'Hazards',
    hazard_control: 'Hazard control',
    recovery: 'Recovery',
    pivot: 'Pivoting',
    priority: 'Priority',
  },
} as const;
