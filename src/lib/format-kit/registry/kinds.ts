/**
 * Primitive kinds: the vocabulary of format building blocks. 40 are available today; 14 more are
 * reserved so documents can name them and fail with `not_available_yet` instead of being
 * misread. A kind is `<family>.<name>`; `kindKey` turns it into a catalog key segment.
 */

export const AVAILABLE_KINDS = [
  'stage.define',
  'group.form',
  'pairing.round_robin',
  'pairing.swiss',
  'pairing.single_elim',
  'pairing.double_elim',
  'pairing.manual',
  'series.rule',
  'team.ruleset',
  'score.match',
  'rank.metric',
  'rank.head_to_head',
  'rank.coin_flip',
  'rank.decision_match',
  'rank.manual',
  'standings.view',
  'advance.rule',
  'advance.top_n',
  'advance.per_group',
  'advance.wildcard',
  'advance.threshold',
  'advance.bottom_n',
  'advance.manual_list',
  'rule.custom',
  'text.rules',
  'theme.hint',
  'module.legacy',
  'attr.define',
  'attr.assign',
  'domain.define',
  'relation.define',
  'resource.define',
  'metric.define',
  'rule.on_event',
  'effect.apply',
  'player.action',
  'track.progression',
  'score.placement',
  'check.assisted',
  'adjust.manual',
] as const;

export const RESERVED_KINDS = [
  'pairing.bipartite',
  'pairing.filter',
  'pairing.challenge',
  'constraint.type_quota',
  'constraint.tera',
  'constraint.evolution_stage',
  'constraint.count',
  'constraint.distinct',
  'constraint.roster_size',
  'acquire.draft',
  'time.schedule',
  'time.deadline_policy',
  'stage.end_when',
  'stage.foreach_group',
] as const;

export type AvailableKind = (typeof AVAILABLE_KINDS)[number];
export type ReservedKind = (typeof RESERVED_KINDS)[number];
export type PrimitiveKind = AvailableKind | ReservedKind;

export const PRIMITIVE_KINDS: readonly PrimitiveKind[] = [...AVAILABLE_KINDS, ...RESERVED_KINDS];

/** `pairing.round_robin` -> `pairing_round_robin`: the segment used in catalog keys. */
export function kindKey(kind: string): string {
  return kind.split('.').join('_');
}

/** What an `adjust.manual` rule can allow an admin to change by hand. */
export const ADJUST_KINDS = ['points', 'resource', 'relation', 'outcome', 'action', 'domain', 'rank'] as const;
