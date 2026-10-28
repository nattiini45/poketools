import { defineBinding, type VerifyCall, type VerifyResult } from '@/lib/ai/admin-agent/dispatch';
import { tournamentCreateBody } from './schemas';
import { canAdministerTournament, createdSince, idOfOutcome, idOfResult, nameKey, readNewestTournaments, readTournament } from './shared';

/**
 * `tournament_create`: `POST /api/tournaments`, a standalone tournament, public the moment it exists. The route grants the
 * creator admin rights on a best-effort basis (a failure is logged and the request still answers 201), which is why the
 * read-back checks them.
 *
 * Read-back: by the id the route answered with, else by natural key (name, standalone, bracket, ruleset, created after the
 * approval, not archived). Then the live admin must administer it (a site admin always does, anyone else through a
 * `resource_admins` row): otherwise the tournament exists and the step is `failed` with `created_but_unadministrable`; the
 * id is kept so the tournament can be archived.
 */
export const tournamentCreate = defineBinding<VerifyCall>({
  operation: 'tournament_create',
  method: 'POST',
  path: '/api/tournaments',
  class: 'B',
  phase: 1,
  load: () => import('@/app/api/tournaments/route'),
  bodySchema: tournamentCreateBody,
  reversal: {
    kind: 'compensating',
    operation: 'tournament_archive',
    buildInput: (_call, result) => {
      const id = idOfResult(result);
      if (id === null) throw new Error('tournament_create left no tournament id to archive');
      return { params: { id }, body: { archived: true } };
    },
  },
  async verify(call, outcome, ctx): Promise<VerifyResult> {
    let id = idOfOutcome(outcome);
    if (id !== null) {
      if ((await readTournament(id)) === null) return { status: 'absent' };
    } else {
      const body = tournamentCreateBody.safeParse(call.body);
      if (!body.success || ctx.approvedAt === undefined) return { status: 'unknown' };
      const wanted = body.data;
      const approvedAt = ctx.approvedAt;
      const matches = (await readNewestTournaments()).filter(
        (tournament) =>
          tournament.season_id === null &&
          !tournament.archived &&
          tournament.bracket_type === wanted.bracket_type &&
          tournament.ruleset_id.toLowerCase() === wanted.ruleset_id.toLowerCase() &&
          nameKey(tournament.name) === nameKey(wanted.name) &&
          createdSince(tournament.created_at, approvedAt),
      );
      if (matches.length === 0) return { status: 'absent' };
      if (matches.length > 1) return { status: 'unknown', detail: { ambiguous: true, matches: matches.length } };
      id = matches[0].id;
    }

    if (!(await canAdministerTournament(ctx.adminId, ctx.isSiteAdmin, id))) {
      return { status: 'failed', code: 'created_but_unadministrable', detail: { id } };
    }
    return { status: 'confirmed', detail: { id } };
  },
});
