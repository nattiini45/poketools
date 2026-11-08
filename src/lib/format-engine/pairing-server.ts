/**
 * What the pairing of a filter or bipartite stage reads from the league's runtime state: the `allow` expression over the
 * pair env, and the side of every player. Server only (the attribute values and the season seed live in the kit
 * context); `pairing.ts` stays pure and takes the results as arguments.
 */
import 'server-only';

import { attributeMap } from '@/lib/format-kit/engine/runtime-names';
import { evaluate } from '@/lib/format-kit/expr/eval';
import type { Stage } from '@/lib/format-kit/types';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { logger } from '@/lib/logger';
import { openFormatCheck } from '@/lib/supabase/queries/format-runtime';
import { memoisedPlayerAttrs, pairContext, playerAttrValue } from './runtime/expr-env';
import { envBaseOf, loadFreshKitContext } from './runtime/load';
import { planForbiddenPairingCheck } from './runtime/pairing-checks';
import { isFormatContextStale } from './runtime/stale';

const TAG = 'format-engine/pairing';

/**
 * The `allow` expression of a filter could not be evaluated for a pair: the round is not paired on a guess. A user-facing
 * 422 (the stage's expression is the admin's to fix), so the generate routes answer it instead of a generic 500. The
 * player ids stay on the error for the log and never enter the message.
 */
export class PairingExprError extends UserFacingError<'pairing_expr_failed'> {
  constructor(readonly exprCode: string, readonly pair: readonly [string, string]) {
    super('The filter of this stage could not be evaluated for a pair of players, so the round was not paired.', {
      code: 'pairing_expr_failed',
      params: { issue: exprCode },
      status: 422,
    });
    this.name = 'PairingExprError';
  }
}

export interface PairingAids {
  /** Filter stages: whether two players may be paired in the round of the input. */
  allowPair?: (a: string, b: string) => boolean;
  /** Filter stages: the same for any round (the `round` of the pair env), for callers that write several rounds. */
  allowPairFor?: (round: number) => (a: string, b: string) => boolean;
  /** Bipartite stages: the side of each player; a player whose attribute is in neither side is absent. */
  sides?: Record<string, 'a' | 'b'>;
}

export interface PairingAidsInput {
  seasonId: string;
  stage: Pick<Stage, 'key' | 'pairing'>;
  /** The round being paired: the `round` of the pair env. */
  roundNumber: number;
  /** Every player the stage pairs (all groups of it). */
  playerIds: readonly string[];
}

/**
 * The aids a filter or bipartite stage needs to pair a round. A pair is allowed when the expression is true for at least
 * one order of the two players (a pairing has no order, and `a` / `b` are only names for the two). Other pairing kinds
 * need none and return an empty object without reading the runtime state.
 */
export async function loadPairingAids(input: PairingAidsInput): Promise<PairingAids> {
  const { pairing } = input.stage;
  if (pairing.kind !== 'filter' && pairing.kind !== 'bipartite') return {};
  const ctx = await loadFreshKitContext(input.seasonId);
  if (ctx === null) throw new Error(`loadPairingAids: league ${input.seasonId} does not run a kit format`);
  const base = envBaseOf(ctx, `pairing:${input.stage.key}:${input.roundNumber}`);

  if (pairing.kind === 'bipartite') {
    const attr = attributeMap(ctx.def).get(pairing.attr);
    if (attr === undefined) throw new Error(`loadPairingAids: stage ${input.stage.key} names the unknown attribute ${pairing.attr}`);
    const sides: Record<string, 'a' | 'b'> = {};
    for (const id of input.playerIds) {
      const value = playerAttrValue(base, id, attr);
      if (typeof value !== 'string') continue;
      if (pairing.side_a.includes(value)) sides[id] = 'a';
      else if (pairing.side_b.includes(value)) sides[id] = 'b';
    }
    return { sides };
  }

  const attrsOf = memoisedPlayerAttrs(base);
  const allowFor = (round: number): ((a: string, b: string) => boolean) => {
    const verdicts = new Map<string, boolean>();
    const holds = (a: string, b: string): boolean => {
      const result = evaluate(pairing.allow, pairContext(base, { a, b, round }, attrsOf), 'boolean');
      if (!result.ok) throw new PairingExprError(result.issue.code, [a, b]);
      return result.value === true;
    };
    return (a, b) => {
      const key = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
      let verdict = verdicts.get(key);
      if (verdict === undefined) {
        verdict = holds(a, b) || holds(b, a);
        verdicts.set(key, verdict);
      }
      return verdict;
    };
  };
  return { allowPair: allowFor(input.roundNumber), allowPairFor: allowFor };
}

/**
 * A filtered round that had to pair `forbidden` rejected pairs (or, in a round robin, dropped them): opens a
 * `pairing_forbidden` check so an admin sees it. One check per stage and round. Best effort: the round is written, so a
 * failed write is logged with its error and does not fail the call.
 */
export async function openForbiddenPairingCheck(input: {
  seasonId: string;
  stageKey: string;
  round: number;
  forbidden: number;
  /** The `season_formats.revision` of the kit phase the round was paired from (a stale one opens nothing). */
  revision: number;
}): Promise<void> {
  const plan = planForbiddenPairingCheck(input.stageKey, input.round, input.forbidden);
  if (plan === null) return;
  try {
    await openFormatCheck({
      seasonId: input.seasonId,
      source: plan.source,
      ruleId: plan.rule_id,
      dedupeKey: plan.dedupe_key,
      subject: plan.subject,
      revision: input.revision,
    });
  } catch (error) {
    if (isFormatContextStale(error)) {
      logger.warn(TAG, 'the format changed since the round was paired; the forbidden pairing check was not opened', {
        seasonId: input.seasonId,
        stage: input.stageKey,
        round: input.round,
      });
      return;
    }
    logger.error(TAG, 'could not open the forbidden pairing check', { seasonId: input.seasonId, stage: input.stageKey, round: input.round, error });
  }
}
