/**
 * Assisted checks (`check.assisted`): situations the engine cannot settle alone and an admin should look at. A planner
 * turns one observation into the checks to open; each carries a dedupe key, so observing the same situation twice opens
 * one check (`format_check_open` ignores a key that exists). Keys:
 *
 * - unresolved outcome: `unresolved:<matchId>`
 * - standings tie: `tie:<stageKey>:<ids of the tied players, sorted, joined by ,>` (stage completed, chain ends in a decision match)
 * - pairing rematch: `rematch:<stageKey>:<round>`
 * - expression: `expr:<ruleId>:<player or match id>`
 *
 * Pure and client-safe.
 */
import type { EvalContext } from '@/lib/format-kit/expr/ast';
import { evaluate } from '@/lib/format-kit/expr/eval';
import type { CheckRule, FormatDefinition } from '@/lib/format-kit/types';
import type { Json } from '@/types/database';
import type { RuntimeIssue } from './types';

export type CheckSource = CheckRule['source']['kind'];

export interface CheckPlan {
  source: CheckSource;
  rule_id: string;
  dedupe_key: string;
  subject: Json;
}

export interface TieRow {
  player_id: string;
  needs_decision_match: boolean;
  tie_group: number | null;
}

export type ChecksInput =
  | { source: 'unresolved_outcome'; matchId: string; players: readonly string[] }
  | { source: 'standings_tie'; stage: string; table: readonly TieRow[] }
  | { source: 'pairing_rematch'; stage: string; round: number; rematches: number }
  | { source: 'expr'; of: 'player' | 'match'; subjects: readonly { id: string; ctx: EvalContext }[] };

export interface ChecksPlan {
  checks: CheckPlan[];
  issues: RuntimeIssue[];
}

/** The checks `input` opens, one per matching rule and situation; a repeated dedupe key keeps the first rule. */
export function planChecks(def: Pick<FormatDefinition, 'rules'>, input: ChecksInput): ChecksPlan {
  const checks: CheckPlan[] = [];
  const issues: RuntimeIssue[] = [];
  const seen = new Set<string>();
  const add = (check: CheckPlan): void => {
    if (seen.has(check.dedupe_key)) return;
    seen.add(check.dedupe_key);
    checks.push(check);
  };

  for (const rule of def.rules) {
    if (rule.kind !== 'check.assisted' || rule.source.kind !== input.source) continue;
    const source = rule.source;
    switch (input.source) {
      case 'unresolved_outcome':
        add({
          source: input.source,
          rule_id: rule.id,
          dedupe_key: `unresolved:${input.matchId}`,
          subject: { match_id: input.matchId, players: [...input.players] },
        });
        break;
      case 'standings_tie': {
        if ('stage' in source && source.stage !== undefined && source.stage !== input.stage) break;
        const groups = new Map<number, string[]>();
        for (const row of input.table) {
          if (!row.needs_decision_match || row.tie_group === null) continue;
          groups.set(row.tie_group, [...(groups.get(row.tie_group) ?? []), row.player_id]);
        }
        for (const [group, ids] of groups) {
          const sorted = [...ids].sort();
          add({
            source: input.source,
            rule_id: rule.id,
            dedupe_key: `tie:${input.stage}:${sorted.join(',')}`,
            subject: { stage: input.stage, players: sorted, tie_group: group },
          });
        }
        break;
      }
      case 'pairing_rematch':
        if (('stage' in source && source.stage !== undefined && source.stage !== input.stage) || input.rematches < 1) break;
        add({
          source: input.source,
          rule_id: rule.id,
          dedupe_key: `rematch:${input.stage}:${input.round}`,
          subject: { stage: input.stage, round: input.round, rematches: input.rematches },
        });
        break;
      case 'expr': {
        if (source.kind !== 'expr' || source.of !== input.of) break;
        for (const subject of input.subjects) {
          const result = evaluate(source.when, subject.ctx, 'boolean');
          if (!result.ok) {
            issues.push({ code: 'expr_failed', rule: rule.id, detail: result.issue.code });
            continue;
          }
          if (result.value === true) {
            add({
              source: input.source,
              rule_id: rule.id,
              dedupe_key: `expr:${rule.id}:${subject.id}`,
              subject: { of: input.of, id: subject.id },
            });
          }
        }
        break;
      }
    }
  }
  return { checks, issues };
}
