import { defineBinding, type VerifyCall, type VerifyResult } from '@/lib/ai/admin-agent/dispatch';
import { leagueArchiveCall } from '@/lib/ai/admin-agent/plans/undo-recipes';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { leagueCreateBody } from './schemas';
import { createdSince, idOfOutcome, nameKey, readLeague, readLiveLeagues } from './shared';

/**
 * `league_create`: `POST /api/seasons`. Public the moment it exists. The route pins the ruleset, creates a Point Buy league's
 * format rules and (for a plain league admin) grants the creator; a `clone_from` copies the source's phases.
 *
 * Read-back: by the id the route answered with; when it answered nothing (a masked 500, a timeout) by natural key, because
 * `seasons` has no creator column and names are not unique: name, creation after the approval, the format, the ruleset and
 * not archived. One match is adopted as the result, more than one is `ambiguous` and the executor stops and asks.
 */
export const leagueCreate = defineBinding<VerifyCall>({
  operation: 'league_create',
  method: 'POST',
  path: '/api/seasons',
  class: 'B',
  phase: 1,
  load: () => import('@/app/api/seasons/route'),
  bodySchema: leagueCreateBody,
  reversal: {
    kind: 'compensating',
    operation: 'league_archive',
    buildInput: (_call, result) => leagueArchiveCall(result),
  },
  async verify(call, outcome, ctx): Promise<VerifyResult> {
    const knownId = idOfOutcome(outcome);
    if (knownId !== null) {
      const league = await readLeague(knownId);
      return league === null ? { status: 'absent' } : { status: 'confirmed', detail: { id: league.id, ruleset_id: league.ruleset_id } };
    }

    // The route did not say which league it made: look for it.
    const body = leagueCreateBody.safeParse(call.body);
    if (!body.success || ctx.approvedAt === undefined) return { status: 'unknown' };
    const wanted = body.data;
    const approvedAt = ctx.approvedAt;
    // Without an explicit ruleset the route pins none, except a Point Buy league, which pins the shared battle ruleset.
    const rulesetFits = (rulesetId: string | null): boolean =>
      wanted.ruleset_id ? rulesetId === wanted.ruleset_id : isEvolutionPointBuy(wanted.format_type) || rulesetId === null;
    const matches = (await readLiveLeagues()).filter(
      (league) =>
        !league.archived &&
        league.format_type === wanted.format_type &&
        nameKey(league.name) === nameKey(wanted.name) &&
        rulesetFits(league.ruleset_id) &&
        createdSince(league.created_at, approvedAt),
    );
    if (matches.length === 0) return { status: 'absent' };
    if (matches.length > 1) return { status: 'unknown', detail: { ambiguous: true, matches: matches.length } };
    return { status: 'confirmed', detail: { id: matches[0].id, ruleset_id: matches[0].ruleset_id } };
  },
});
