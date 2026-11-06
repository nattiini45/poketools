/**
 * What a deadline policy does to one match or one player whose deadline passed. Pure and client-safe; the cron pass
 * (`cron.ts`) applies the plans.
 *
 * - `admin_review` opens a `deadline_missed` check, one per match (or per player for an action).
 * - `forfeit` settles a match whose side missed: the side without a registered team forfeits and the other side wins.
 *   When both or neither side has a team nobody is at fault in a way the engine can tell, so it opens the check instead
 *   (`reason: undecidable_forfeit`) and an admin decides.
 * - `auto_lock` and `seeded_random_pick` belong to actions and are applied by the cron pass itself.
 *
 * Keys: `deadline:<stage>:<policy index>:<match id | action:player>`.
 */
import type { DeadlinePolicy } from '@/lib/format-kit/types';
import type { Json } from '@/types/database';

export interface DeadlineCheckPlan {
  source: 'deadline_missed';
  rule_id: string;
  dedupe_key: string;
  subject: Json;
}

export interface ForfeitPlan {
  matchId: string;
  winnerId: string;
  loserId: string;
  reason: string;
}

export type MatchPolicyPlan = { kind: 'check'; check: DeadlineCheckPlan } | { kind: 'forfeit'; forfeit: ForfeitPlan };

export interface PolicyMatch {
  id: string;
  player_1_id: string;
  player_2_id: string;
}

export interface MatchPolicyInput {
  stage: string;
  policyIndex: number;
  policy: Pick<DeadlinePolicy, 'applies' | 'on_miss'>;
  round: number;
  match: PolicyMatch;
  /** The players of the match with a registered team: one linked to the match, else their planned one (`getPlayerTeamForMatch`). */
  teamed: ReadonlySet<string>;
}

const ruleId = (stage: string, policyIndex: number): string => `deadline:${stage}:${policyIndex}`;

function matchCheck(input: MatchPolicyInput, reason: string): DeadlineCheckPlan {
  return {
    source: 'deadline_missed',
    rule_id: ruleId(input.stage, input.policyIndex),
    dedupe_key: `deadline:${input.stage}:${input.policyIndex}:${input.match.id}`,
    subject: {
      stage: input.stage,
      applies: input.policy.applies,
      on_miss: input.policy.on_miss,
      round: input.round,
      match_id: input.match.id,
      players: [input.match.player_1_id, input.match.player_2_id],
      reason,
    },
  };
}

/** The plan for an unfinished match of a round past its policy instant (policies `match` and `team`). */
export function planMatchPolicy(input: MatchPolicyInput): MatchPolicyPlan {
  if (input.policy.on_miss !== 'forfeit') return { kind: 'check', check: matchCheck(input, 'admin_review') };
  const { match, teamed } = input;
  const missing = [match.player_1_id, match.player_2_id].filter((id) => !teamed.has(id));
  if (missing.length !== 1) return { kind: 'check', check: matchCheck(input, 'undecidable_forfeit') };
  const loserId = missing[0];
  return {
    kind: 'forfeit',
    forfeit: {
      matchId: match.id,
      loserId,
      winnerId: loserId === match.player_1_id ? match.player_2_id : match.player_1_id,
      reason: 'Deadline missed: no team was registered before the round deadline',
    },
  };
}

/**
 * The check for one player who has not submitted an action: the policy is `admin_review`, or a `seeded_random_pick` that
 * could not be applied (`reason` names why).
 */
export function planActionCheck(
  stage: string,
  policyIndex: number,
  action: string,
  playerId: string,
  reason = 'admin_review',
): DeadlineCheckPlan {
  return {
    source: 'deadline_missed',
    rule_id: ruleId(stage, policyIndex),
    dedupe_key: `deadline:${stage}:${policyIndex}:${action}:${playerId}`,
    subject: { stage, applies: 'action', on_miss: 'admin_review', action, player_id: playerId, reason },
  };
}

/** The mark under which the lock event of an action policy is logged, so it fires once per policy. */
export const policyLockMark = (stage: string, policyIndex: number): string => `deadline:${stage}:${policyIndex}`;
