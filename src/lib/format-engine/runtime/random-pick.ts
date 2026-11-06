/**
 * The `seeded_random_pick` of a missed action deadline: for a player who has not submitted, a valid set of picks drawn
 * from the season seed. Each step takes its candidates in the order of a seeded draw per entry and keeps the first
 * `count` that `validateActionSubmission` accepts for that entry (unlocked domain, `where`, `distinct_attr`, capacity,
 * exclusivity), so the same state and seed always give the same picks. Null when no valid set exists. The draw is the
 * system's, not a player's: it takes its candidates from the full list of the domain and validates them with the
 * `system` audience (a domain only admins see is still a valid source of a deadline pick). Pure and client-safe.
 */
import { seededRand } from '@/lib/format-kit/expr/rand';
import type { FormatDefinition } from '@/lib/format-kit/types';
import { findAction, validateActionSubmission } from './actions';
import { findDomainView } from './domains';
import type { ActionPick, KitRuntimeState } from './types';

const SYSTEM = { audience: 'system' } as const;

export function planRandomPicks(
  def: FormatDefinition,
  actionId: string,
  actorId: string,
  state: KitRuntimeState,
  roster: readonly string[],
  seed: string,
): ActionPick[] | null {
  const rule = findAction(def, actionId);
  if (rule === null) return null;
  const picks: ActionPick[] = [];
  for (let step = 0; step < rule.steps.length; step += 1) {
    const spec = rule.steps[step];
    const view = findDomainView(def, spec.domain, state.flags, state.amendments);
    if (view === null) return null;
    const candidates = view.entries
      .map((entry) => ({ id: entry.id, draw: seededRand(seed, `deadline_pick:${actionId}`, `${actorId}:${step}:${entry.id}`) }))
      .sort((a, b) => a.draw - b.draw || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    let taken = 0;
    for (const candidate of candidates) {
      if (taken >= spec.count) break;
      const attempt = [...picks, { step, item_id: candidate.id }];
      const checked = validateActionSubmission(def, actionId, actorId, attempt, state, roster, seed, SYSTEM);
      if (!checked.ok && checked.issues.some((issue) => issue.item_id === candidate.id)) continue;
      picks.push({ step, item_id: candidate.id });
      taken += 1;
    }
    if (taken < spec.count) return null;
  }
  const final = validateActionSubmission(def, actionId, actorId, picks, state, roster, seed, SYSTEM);
  return final.ok ? picks : null;
}
