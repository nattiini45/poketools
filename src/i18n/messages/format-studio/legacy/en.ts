/**
 * Namespace `format-studio/legacy`: the texts `describeLegacy` (`src/lib/format-studio/legacy`) writes into the
 * definition it builds from a live league. The descriptor stores both languages in the document, so this catalog
 * is read in English and in German at once (`createTranslator(ns, 'en')` and `'de'`), never for a viewer.
 *
 * - `stage.fallback` and `season.fallback` name a phase or league whose stored name is empty.
 * - `facts.<key>` label the facts of the legacy modules (the settings that stay in the league admin).
 * - `override.*` and `advancement.*` fill the text sections that keep a stored setting the kit cannot express yet.
 */
export default {
  stage: {
    fallback: 'Phase {n}',
  },
  season: {
    fallback: 'League',
  },
  facts: {
    core_pool_size: 'Cores in the pool',
    cores_assigned: 'Players with an assigned core',
    gym_types_assigned: 'Players with a gym type',
    roster_size: 'Players in the league',
    tier_limit_s: 'Pick limit for tier S',
    tier_limit_a: 'Pick limit for tier A',
    tier_limit_b: 'Pick limit for tier B',
    tier_limit_c: 'Pick limit for tier C',
    match_points_win: 'Match points per win',
    tiebreak_match_points: 'Tiebreak position of match points',
    tiebreak_kill_difference: 'Tiebreak position of the KO difference',
    tiebreak_evolution_points: 'Tiebreak position of evolution points',
    tiebreak_head_to_head: 'Tiebreak position of the head-to-head result',
    tiebreak_decision_match: 'Tiebreak position of the decision match',
    tera_stage1: 'Terastallization for stage 1 Pokémon',
    tera_stage2: 'Terastallization for stage 2 Pokémon',
    tera_stage3: 'Terastallization for stage 3 Pokémon',
    draft_budget: 'Draft budget',
    draft_picks: 'Draft picks',
    draft_token_ratio: 'Draft token ratio',
    draft_token_max: 'Draft tokens per player (maximum)',
    draft_token_max_per_line: 'Draft tokens per line (maximum)',
    redraft_open: 'Redraft phase open',
    banned_moves: 'Banned moves',
    banned_items: 'Banned items',
    stage_lock_enabled: 'Early final-stage lock',
    stage_lock_stage: 'Stage the lock applies to',
    stage_lock_by_matchday: 'Lock applies up to matchday',
    stage_lock_suspend_matchdays: 'Matchdays a locked player is suspended',
    participation_per_matchday: 'Participation points per matchday',
    participation_until_stage: 'Participation points until stage',
    comeback_earn_window: 'Comeback tokens are earned over',
  },
  override: {
    title: 'Match lengths in {stage}',
    line: '{round} is played as best of {best_of}.',
  },
  advancement: {
    unused_title: 'Advancement of {stage}',
    unused: 'The advancement rule of {stage} lets {rule} advance, but no later phase takes players from it.',
    rule_top_n: {
      one: 'the best player overall',
      other: 'the best {count} players overall',
    },
    rule_per_group: {
      one: 'the best player of each group',
      other: 'the best {count} players of each group',
    },
  },
} as const;
