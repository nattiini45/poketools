/**
 * `draft/legacy/board` (owner DL-UI-1, draft-frontend §8.5): the legacy 2D
 * draft board and its parts — `DraftBoard`, `PickSelector`, `DraftPoolManager`,
 * `TierListDisplay`, `EvolutionRosterCard`, `EvolutionEventBanner`.
 *
 * `en` is the components' English verbatim, except the §8.3 naming edits
 * (Draft Kill Token instead of "draft token"; total progress is never labelled
 * KOs). League terms come from `glossary`, shared legacy terms from
 * `draft/legacy`, API errors from `errors/draft` + `errors/draft-legacy`.
 */
export default {
  board: {
    loading: 'Loading draft...',
    columns: {
      round: 'Round',
      player: 'Player',
      pokemon: 'Pokémon',
      cost: 'Cost',
    },
    /** The board's own fallbacks; server errors render through the error catalogs. */
    errors: {
      loadState: 'Failed to load draft state',
      loadFailed: 'Failed to load draft',
      makePick: 'Failed to make pick',
      undo: 'Failed to undo pick',
      statusChange: 'Failed to update draft status',
      freeOrder: 'Failed to switch the draft to free order',
    },
    epb: {
      pointsUsed: 'Points used',
      pointsRemaining: 'Points remaining',
      picksUsed: 'Picks used',
      picksRemaining: 'Picks remaining',
      purchasableTokens: {
        one: 'Purchasable Draft Kill Tokens: <b>{count}</b> ({ratio} leftover points = 1 token, max {max})',
        other: 'Purchasable Draft Kill Tokens: <b>{count}</b> ({ratio} leftover points = 1 token, max {max})',
      },
    },
    roundPick: 'Round {round} · Pick #{pick}',
    startDraft: 'Start Draft',
    undoLastPick: 'Undo Last Pick',
    yourTurn: "It's your turn to pick!",
    waitingFor: 'Waiting for {name} to pick...',
    makePick: 'Make a Pick',
    /** Free pick order: no turn callout. */
    freeOrder: 'Free order: everyone picks when they like. Admins can enter picks for anyone.',
    /** Free order, admins: whose pick the next pick is. */
    pickFor: 'Pick for',
    /**
     * Snake/linear order with fixed prices: the current picker cannot afford a pick that leaves enough points for
     * their open picks (`count`, this one included; `cost` = the cheapest Pokémon left for them, together).
     */
    stall: {
      you: {
        one: "You can't make a pick: you have {remaining} points, but the cheapest Pokémon left costs {cost}. An admin can switch the draft to free order so it can go on.",
        other:
          "You can't make a pick: you have {remaining} points, but your {count} open picks cost at least {cost} together. An admin can switch the draft to free order so it can go on.",
      },
      named: {
        one: "{name} can't make a pick: they have {remaining} points, but the cheapest Pokémon left costs {cost}. An admin can switch the draft to free order so it can go on.",
        other:
          "{name} can't make a pick: they have {remaining} points, but their {count} open picks cost at least {cost} together. An admin can switch the draft to free order so it can go on.",
      },
      switch: 'Switch to free order',
      confirmTitle: 'Switch to free order?',
      confirmBody:
        'Turns are no longer enforced: everyone picks when they like, and {name} picks what they can still afford. Picks and points stay as they are. When nothing more can be picked, end the draft. You cannot switch back.',
    },
    /** Free order, admins: ends a running draft (rosters stay as they are). */
    endDraft: 'End Draft',
    endConfirmTitle: 'End the draft?',
    endConfirmBody: 'The draft is marked complete with the picks made so far. Open picks are not filled.',
    complete: 'Draft Complete!',
    tokens: {
      title: 'Allocate Draft Kill Tokens',
      /** Points to the token centre, whose buying window lasts until the first confirmed result. */
      intro:
        'Spend leftover points on Draft Kill Tokens in the token centre until the first match result is confirmed. Each token gives +1 evolution progress on one evolution line — it cannot trigger an evolution.',
    },
    rosters: 'Rosters',
    pickHistory: 'Pick History',
  },
  picker: {
    title: 'Select a Pokémon',
    filterPool: 'Filter draft pool...',
    searchPokemon: 'Search Pokémon...',
    poolOnly: 'Only Pokémon from the draft pool can be drafted.',
    searching: 'Searching...',
    drafted: 'Drafted',
    tierFull: 'Tier Full',
    overBudget: 'Over Budget',
    pointsLabel: 'Points:',
    remaining: '({n} remaining)',
    /** An auction line's reserve: the lowest bid the pick accepts. */
    minBid: 'Minimum bid: {n} pts',
    /**
     * A typed auction bid that is not a whole number. The `bid*` reasons are
     * announced together (joined by a space), so each is a full sentence.
     */
    bidNotWhole: 'Your bid must be a whole number.',
    /** A typed auction bid above the budget the picker has left (`n`). */
    bidOverBudget: 'Your bid is more than your remaining budget of {n} pts.',
    /** A typed auction bid below the reserve (`n`). */
    bidBelowReserve: 'Your bid is below the minimum bid of {n} pts.',
    cost: 'Cost: <b>{cost}</b> points',
    /** `remaining` is the budget left after this pick (remaining budget − cost). */
    costWithRemaining: 'Cost: <b>{cost}</b> points · {remaining} remaining after pick',
    /** Opens the armed confirmation. */
    confirmPick: 'Confirm Pick',
    confirmTitle: 'Draft {name}?',
    confirmBody: 'Check your choice: only an admin can undo a pick.',
  },
  poolManager: {
    exists: 'A draft pool already exists for <b>{season}</b>.',
    /** Heading and button. */
    create: 'Create Draft Pool',
    setupFor: 'Set up a draft for <b>{season}</b>',
    /** Step 1: turn order (`draft_pools.pick_order`). */
    orderHeading: '1. Draft order',
    orders: {
      snake: { name: 'Snake', description: 'Participant order, reversed every round: 1-2-3, then 3-2-1.' },
      linear: { name: 'Same order every round', description: 'Participant order every round: 1-2-3, then 1-2-3.' },
      free: { name: 'Free order', description: 'No turns. Players pick any time, admins enter picks for them.' },
    },
    /** Step 2: pricing (`draft_pools.draft_type`: snake = none, budget = fixed, auction = auction). */
    pricingHeading: '2. Pricing',
    pricings: {
      none: { name: 'No points', description: 'Picks cost no points. Only tier limits apply.' },
      fixed: { name: 'Fixed prices', description: 'Each Pokémon costs its pool price, paid from the player’s budget.' },
      auction: {
        name: 'Auction bids',
        description: 'Players bid from their budget; the pool price is the minimum bid. Always Free order.',
      },
    },
    /** Shown while auction is chosen: the order is forced to Free. */
    auctionNeedsFree: 'Auctions use Free order: the winning bidder gets the pick, not whoever is up.',
    /** One line on what Create makes; `order` and `pricing` are the chosen option names, `count` the budget. */
    summary: 'Creates: {order}, {pricing}.',
    summaryWithBudget: {
      one: 'Creates: {order}, {pricing}, {count} point per player.',
      other: 'Creates: {order}, {pricing}, {count} points per player.',
    },
    pointBudget: 'Point Budget per Player',
    /** Budget drafts only: the pool's `default_point_cost`. */
    defaultPrice: 'Default Price (optional)',
    defaultPriceHint: 'Pokémon without their own price cost this much. Leave empty for 0.',
    /** Inline field errors of the create form; `max` is the highest accepted value, `budget` the entered budget. */
    errors: {
      budgetInvalid: 'Enter a whole number from 1 to {max}.',
      priceInvalid: 'Enter a whole number from 0 to {max}, or leave the field empty.',
      priceAboveBudget: 'The default price cannot be higher than the point budget ({budget} pts).',
    },
    createFailed: 'Failed to create draft pool',
  },
  /** A pool's turn order and pricing as one label (admin league page, overlay picker); keys from `poolFormat()`. */
  poolFormat: {
    label: '{order} · {pricing}',
    order: { snake: 'Snake', linear: 'Same order every round', free: 'Free order' },
    pricing: { none: 'No points', fixed: 'Fixed prices', auction: 'Auction bids', pointBuy: 'Point Buy' },
  },
  tierList: {
    tier: '{tier}-Tier',
    availableLimited: '{count} available · max {max} per player',
    availableUnlimited: '{count} available · unlimited',
    groupCount: '{count} Pokémon',
    groupCountLimited: '{count} Pokémon · max {max} picks',
    /** Next stage of a legacy evo-league tier and the KOs it needs. */
    nextStage: { one: '→ {name} ({count} KO)', other: '→ {name} ({count} KOs)' },
  },
  rosterCard: {
    /** Badges, rendered uppercase by CSS. */
    wild: 'Wild',
    max: 'Max',
    wasBase: 'was {name}',
    /** Total progress (all sources) still missing; never labelled KOs. */
    progressTo: { one: '{count} progress to {form}', other: '{count} progress to {form}' },
  },
  evolutionEvent: {
    evolved: 'Evolved!',
    devolved: 'De-evolved!',
    /** `total` is the line's total progress (all sources). */
    evolvedInto: "<b>{player}</b>'s {from} evolved into <b>{to}</b> (progress {total})",
    revertedTo: "<b>{player}</b>'s {from} reverted to <b>{to}</b> (progress {total})",
  },
} as const;
