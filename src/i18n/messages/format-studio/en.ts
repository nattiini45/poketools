/**
 * Namespace `format-studio`: the sentences behind the format kit's compiler diagnostics and fixes
 * (`src/lib/format-kit/engine`). A diagnostic is stored as a code plus params; these templates turn it into a
 * sentence after the read.
 *
 * - `diagnostics.<code>`: one sentence per diagnostic code. Stage-like params arrive as display names when the
 *   renderer has the definition, and as keys otherwise. `{pointer}` is the JSON pointer of the diagnostic.
 * - `fixes.<fixId>`: the label of a one-click fix.
 * - `reasons.*` fills the `reason` param of `diagnostics.metric_unproduced`; the `metric` param is labelled with
 *   `metric.*` of `format-studio/primitives`, so a metric reads the same in a diagnostic and in a description.
 * - Count-bearing sentences are `{one, other}` forms; the renderer passes the number they depend on as `count`.
 *
 * The matching primitive descriptions live in `format-studio/primitives`.
 */
export default {
  diagnostics: {
    schema_required: 'A required value is missing at {pointer}.',
    schema_type: 'The value at {pointer} has the wrong type.',
    schema_enum: 'The value at {pointer} is not one of the allowed options.',
    schema_range: 'The number at {pointer} is outside the allowed range.',
    schema_length: 'The text or list at {pointer} has a length that is not allowed.',
    schema_pattern: 'The value at {pointer} does not have the expected format.',
    schema_unknown_key: 'The field at {pointer} is not part of a format definition.',
    schema_limit: 'The document exceeds a size limit at {pointer}.',
    schema_refine: 'The value at {pointer} breaks a consistency rule.',
    schema_not_available_yet: '{what} is not available yet in this version of the format kit.',
    rule_unknown_primitive: 'Rule kind {kind} is unknown and was kept as a manual rule card.',
    key_duplicate: 'The key {key} is used more than once in {scope}.',
    ref_unknown_stage: 'There is no stage with the key {key}.',
    stage_cycle: 'The stages lead back to themselves: {path}.',
    stage_unreachable: 'Stage {stage} can never receive participants.',
    stage_roster_with_incoming: 'Stage {stage} takes its players from the roster although advancement rules lead into it.',
    stage_too_few_participants: {
      one: 'Stage {stage} would have only {count} participant; at least two are needed.',
      other: 'Stage {stage} would have only {count} participants; at least two are needed.',
    },
    participant_count_unknown: 'The number of participants in stage {stage} is not known yet, so size checks are skipped.',
    groups_too_many: {
      one: 'Stage {stage} splits {participants} participant into {groups} groups; every group needs at least two.',
      other: 'Stage {stage} splits {participants} participants into {groups} groups; every group needs at least two.',
    },
    groups_uneven: 'The {participants} participants of stage {stage} do not split evenly into {groups} groups.',
    advance_exceeds_source: {
      one: 'Advancement rule {edge} asks for {requested} participant, but its source has only {available}.',
      other: 'Advancement rule {edge} asks for {requested} participants, but its source has only {available}.',
    },
    advance_per_group_without_groups: 'Advancement rule {edge} selects per group, but stage {stage} has no groups.',
    advance_bracket_byes: {
      one: 'Stage {stage} starts an elimination bracket of {bracket_size} with a field of {incoming}: {byes} player gets a bye.',
      other: 'Stage {stage} starts an elimination bracket of {bracket_size} with a field of {incoming}: {byes} players get a bye.',
    },
    advance_overlap: {
      one: 'The advancement rules leaving stage {stage} ask for {requested} participant in total, but the stage has only {available}.',
      other: 'The advancement rules leaving stage {stage} ask for {requested} participants in total, but the stage has only {available}.',
    },
    swiss_rounds_too_many:
      'Stage {stage} sets the Swiss rounds to {rounds}, more than a field of {participants} can play without repeating a pairing.',
    series_even_best_of: 'Stage {stage} uses best of {best_of}; an even best-of ends early, use an odd number.',
    series_override_duplicate: 'Stage {stage} overrides the series length of round {round} more than once.',
    series_override_unreachable: {
      one: 'Stage {stage} overrides round {round}, but the stage plays only {rounds} round.',
      other: 'Stage {stage} overrides round {round}, but the stage plays only {rounds} rounds.',
    },
    draws_unsupported: 'Stage {stage} allows draws, but the match model cannot record draws yet.',
    forfeits_unsupported: 'Stage {stage} scores forfeits, but the match model cannot record forfeits yet.',
    players_per_match_unsupported: 'Stage {stage} uses {players} players per match; at most {max} are supported.',
    scoring_win_not_better: 'In stage {stage} a win ({win}) is not worth more than a loss ({loss}).',
    rank_chain_empty: 'Stage {stage} needs at least one rank step to order its table.',
    rank_ignored_for_bracket: 'The rank steps of stage {stage} are ignored because it is an elimination bracket.',
    metric_unproduced: 'The metric {metric} cannot be used here: {reason}.',
    rank_decision_match_position: 'The decision match in stage {stage} has to be the last rank step.',
    rank_open_ended: 'The rank steps of stage {stage} can leave ties unresolved.',
    rank_step_unreachable: 'A rank step in stage {stage} never applies because an earlier step always decides.',
    rank_duplicate_step: 'Stage {stage} repeats a rank step.',
    ruleset_not_found: 'Stage {stage} uses the ruleset {id}, which does not exist.',
    module_duplicate: 'The legacy module {adapter} is added more than once.',
    ltext_untranslated: 'Some texts have no translation for {locale}.',
    expr_shape: 'The condition of advancement rule {edge} is not a well-formed expression.',
    expr_depth: 'The condition of advancement rule {edge} is nested too deeply.',
    expr_nodes: 'The condition of advancement rule {edge} is too large.',
    expr_steps: 'The condition of advancement rule {edge} would take too many evaluation steps.',
    expr_type_mismatch: 'The condition of advancement rule {edge} mixes values of different types.',
    expr_unknown_ref: 'The condition of advancement rule {edge} uses a value that does not exist.',
    expr_ref_type: 'The condition of advancement rule {edge} uses a value with the wrong type.',
    expr_unknown_relation: 'The condition of advancement rule {edge} uses a relation that does not exist.',
    expr_unknown_collection: 'The condition of advancement rule {edge} looks at a collection that does not exist.',
    expr_unknown_field: 'The condition of advancement rule {edge} uses a field the collection does not have.',
    expr_arity: 'The condition of advancement rule {edge} gives a function the wrong number of arguments.',
    expr_number_range: 'The condition of advancement rule {edge} contains a number outside the supported range.',
    expr_string_length: 'The condition of advancement rule {edge} contains a text that is too long.',
    expr_result_type: 'The condition of advancement rule {edge} has to evaluate to true or false.',
    expr_item_scope: 'The condition of advancement rule {edge} uses an item outside an aggregate.',
    expr_nested_aggregate: 'The condition of advancement rule {edge} nests one aggregate inside another.',
  },
  fixes: {
    use_lower_odd: 'Use best of {best_of}',
    use_higher_odd: 'Use best of {best_of}',
    remove_draw: 'Remove the draw setting',
    remove_forfeit: 'Remove the forfeit score',
    set_two_players: 'Play with two players per match',
    remove_rank_step: 'Remove this rank step',
    add_coin_flip: 'Add a coin flip as the last rank step',
    add_wildcard: {
      one: 'Add {n} wildcard spot to fill the bracket',
      other: 'Add {n} wildcard spots to fill the bracket',
    },
    remove_override: 'Remove the override for round {round}',
    move_decision_match_last: 'Move the decision match to the end',
    add_points_step: 'Rank by points',
    clear_rank: 'Clear the rank steps',
    reduce_groups: 'Use {groups} groups',
    set_swiss_rounds_auto: 'Let the Swiss rounds follow the field size',
    use_season_ruleset: 'Use the season ruleset',
    use_edges_source: 'Take the participants from the previous stages',
  },
  severity: {
    error: 'Error',
    warning: 'Warning',
    info: 'Note',
  },
  reasons: {
    unknown_metric: 'it is not a metric the standings can produce',
    needs_kill_stats: 'this league does not record kill statistics',
    needs_rating: 'this league does not keep ratings',
    needs_opponents: 'it needs a stage where two players meet in rounds',
  },
  common: {
    untranslated: 'Not translated yet',
    unnamed: 'Unnamed',
  },
} as const;
