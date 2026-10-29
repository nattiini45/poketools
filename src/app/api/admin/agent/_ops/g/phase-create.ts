import { defineBinding, invokeRoute, type VerifyCall, type VerifyResult } from '@/lib/ai/admin-agent/dispatch';
import { idParams, phaseCreateBody, phaseParams, syncStandingsBody } from './schemas';
import { idOfOutcome, nameKey, readLeague, readPhases } from './shared';

/**
 * Re-runs the enrollment of a phase from the roster or the previous phase's standings (`POST .../sync-standings`). Not a
 * Build step: only the read-back of `phase_create` calls it, as a repair, through `invokeRoute` with the step's own context.
 */
export const phaseSyncStandings = defineBinding<VerifyCall>({
  operation: 'phase_sync_standings',
  method: 'POST',
  path: '/api/seasons/[id]/phases/[phaseId]/participants/sync-standings',
  class: 'B',
  phase: 1,
  load: () => import('@/app/api/seasons/[id]/phases/[phaseId]/participants/sync-standings/route'),
  paramsSchema: phaseParams,
  bodySchema: syncStandingsBody,
  // Derived state: it is re-derived, never undone.
  reversal: { kind: 'none' },
  async verify(call): Promise<VerifyResult> {
    const phase = (await readPhases(call.params.id)).find((candidate) => candidate.id === call.params.phaseId);
    return phase?.enrollment_source ? { status: 'confirmed', detail: { id: phase.id } } : { status: 'absent' };
  },
});

/**
 * `phase_create`: `POST /api/seasons/[id]/phases`. The route is not atomic: it inserts the tournament, grants the creator,
 * runs the enrollment sync and only then expires the caches, so a timeout can leave a phase with no enrollment.
 *
 * Read-back: the phase by the id the route answered with, else by `(season_id, name)` case-insensitively (the API keeps names
 * unique per league). Then its enrollment: a phase whose standings sync did not run (no `enrollment_source`, or no
 * participants while the league has a roster) gets the sync re-run through `invokeRoute` as the same verified session
 * (plan 4.4) before the step is `confirmed`. The detail carries the participant count and the source type.
 */
export const phaseCreate = defineBinding<VerifyCall>({
  operation: 'phase_create',
  method: 'POST',
  path: '/api/seasons/[id]/phases',
  class: 'B',
  phase: 1,
  load: () => import('@/app/api/seasons/[id]/phases/route'),
  paramsSchema: idParams,
  bodySchema: phaseCreateBody,
  // Phases are not deleted (N) and archive with their league: the row stays behind as residue of an archived league.
  reversal: { kind: 'none' },
  async verify(call, outcome, ctx): Promise<VerifyResult> {
    const body = phaseCreateBody.safeParse(call.body);
    if (!body.success) return { status: 'unknown' };
    const seasonId = call.params.id;
    const knownId = idOfOutcome(outcome);

    const find = async () => {
      const phases = await readPhases(seasonId);
      return knownId === null ? phases.filter((phase) => nameKey(phase.name) === nameKey(body.data.name)) : phases.filter((phase) => phase.id.toLowerCase() === knownId);
    };

    let matches = await find();
    if (matches.length === 0) return { status: 'absent' };
    if (matches.length > 1) return { status: 'unknown', detail: { ambiguous: true, matches: matches.length } };
    let phase = matches[0];

    // Enrollment is written last: no source, or an empty phase of a league that has players, means the sync did not finish.
    let missing = phase.enrollment_source === null;
    if (!missing && phase.participant_count === 0) missing = ((await readLeague(seasonId))?.participant_count ?? 0) > 0;

    let resynced = false;
    if (missing) {
      if (ctx.dispatch === undefined) return { status: 'unknown', detail: { id: phase.id, enrollment: 'missing' } };
      const sync = await invokeRoute(phaseSyncStandings, { params: { id: seasonId, phaseId: phase.id }, body: {} }, { ...ctx.dispatch, audit: { ...ctx.dispatch.audit, agent_tool: phaseSyncStandings.operation } });
      if (sync.kind !== 'ok') return { status: 'unknown', detail: { id: phase.id, enrollment: 'missing', sync: sync.kind } };
      resynced = true;
      matches = await find();
      if (matches.length !== 1 || matches[0].enrollment_source === null) return { status: 'unknown', detail: { id: phase.id, enrollment: 'missing', sync: 'ok' } };
      phase = matches[0];
    }

    return {
      status: 'confirmed',
      detail: { id: phase.id, participants: phase.participant_count, enrollment: phase.enrollment_source?.type ?? null, resynced },
    };
  },
});
