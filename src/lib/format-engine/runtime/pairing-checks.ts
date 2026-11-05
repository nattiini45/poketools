/**
 * The assisted check of a filtered pairing that could not keep every pair allowed. Unlike the checks of `checks.ts` it
 * needs no `check.assisted` rule in the format: a filter that is broken is always worth an admin's look. Key:
 * `forbidden:<stageKey>:<round>`. Pure and client-safe.
 */
import type { Json } from '@/types/database';

export interface ForbiddenPairingCheck {
  source: 'pairing_forbidden';
  rule_id: string;
  dedupe_key: string;
  subject: Json;
}

/** The rule id the check carries: the check has no rule of its own. */
export const FORBIDDEN_PAIRING_RULE_ID = 'pairing.filter';

/** The check a round with `forbidden` rejected pairs opens, or null when it has none. */
export function planForbiddenPairingCheck(stage: string, round: number, forbidden: number): ForbiddenPairingCheck | null {
  if (forbidden < 1) return null;
  return {
    source: 'pairing_forbidden',
    rule_id: FORBIDDEN_PAIRING_RULE_ID,
    dedupe_key: `forbidden:${stage}:${round}`,
    subject: { stage, round, forbidden },
  };
}
