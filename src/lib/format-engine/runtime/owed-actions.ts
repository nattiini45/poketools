/**
 * How many actions of a kit format a player still owes: the window is open, the player may act, and they have submitted
 * nothing yet or only saved a draft. Pure; the dashboard's "Now" queue counts with it from narrow reads instead of
 * loading the whole runtime state. The window and submission rules are the ones of the player view (`views.ts`).
 */
import type { FormatDefinition, PlayerActionRule } from '@/lib/format-kit/types';
import type { Json } from '@/types/database';
import { toSubmissionView, windowOf } from './views';

export interface OwedActionsInput {
  def: Pick<FormatDefinition, 'rules'>;
  /** The league's flags by key (`action:<id>` holds a window). */
  flags: Record<string, Json>;
  /** The player's own submissions in the league. */
  submissions: readonly { action_key: string; status: string }[];
  /** The relations the player holds a link from (an action `via` a relation needs one). */
  linkedRelations: ReadonlySet<string>;
}

export function countOwedActions({ def, flags, submissions, linkedRelations }: OwedActionsInput): number {
  const rules = Array.isArray(def.rules) ? def.rules.filter((rule): rule is PlayerActionRule => rule.kind === 'player.action') : [];
  let owed = 0;
  for (const rule of rules) {
    if (windowOf(rule, { flags }) !== 'open') continue;
    if (rule.via !== undefined && !linkedRelations.has(rule.via)) continue;
    const submission = submissions.find((row) => row.action_key === rule.id);
    if (submission === undefined || toSubmissionView({ status: submission.status, picks: [] }).state === 'draft') owed += 1;
  }
  return owed;
}
