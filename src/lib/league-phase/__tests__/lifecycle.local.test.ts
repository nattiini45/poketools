import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLoopbackUrl, localStackOptIn, requireLocalKey } from '@/test/local-stack';
import { deleteLocalRuleset, insertLocalRuleset } from '@/test/local-rulesets';
import type { Phase } from '@/types/league-phase';
import type { Database } from '@/types/database';

const optedIn = localStackOptIn('LOCAL_LEAGUE_PHASE');

describe.skipIf(!optedIn)('native phase lifecycle on the disposable local stack', () => {
  const seasonId = randomUUID();
  const rulesetId = randomUUID();
  const playerIds = Array.from({ length: 5 }, () => randomUUID());
  const leagueGroupIds = [randomUUID(), randomUUID()];
  let admin: SupabaseClient<Database>;
  let phases: typeof import('@/lib/supabase/queries/league-phases');
  let rounds: typeof import('@/lib/supabase/queries/phase-rounds');
  let groups: typeof import('@/lib/supabase/queries/phase-groups');

  beforeAll(async () => {
    assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
    admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, requireLocalKey('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const mode = await admin.from('phase_storage_state').select('mode').single();
    expect(mode.error).toBeNull();
    expect(mode.data?.mode).toBe('phase');
    expect((await admin.from('players').insert(playerIds.map((id, i) => ({ id, name: `Phase fixture ${seasonId}-${i}`, is_guest: true })))).error).toBeNull();
    expect((await insertLocalRuleset(admin, { id: rulesetId, name: `Phase fixture ${seasonId}` })).error).toBeNull();
    expect((await admin.from('seasons').insert({ id: seasonId, name: 'Native lifecycle fixture', format_type: 'singles', ruleset_id: rulesetId })).error).toBeNull();
    expect((await admin.from('season_participants').insert(playerIds.slice(0, 4).map((player_id) => ({ season_id: seasonId, player_id })))).error).toBeNull();
    expect((await admin.from('season_groups').insert(leagueGroupIds.map((id, i) => ({ id, season_id: seasonId, name: `Fixture ${i}`, sort_order: i + 1 })))).error).toBeNull();
    expect((await admin.from('season_group_members').insert(playerIds.slice(0, 4).map((player_id, i) => ({ season_id: seasonId, group_id: leagueGroupIds[i % 2], player_id })))).error).toBeNull();
    [phases, rounds, groups] = await Promise.all([
      import('@/lib/supabase/queries/league-phases'), import('@/lib/supabase/queries/phase-rounds'), import('@/lib/supabase/queries/phase-groups'),
    ]);
  });

  afterAll(async () => {
    if (!admin) return;
    const trash = await admin.rpc('league_trash_delete', { p_season_id: seasonId, p_actor: playerIds[0], p_retention_days: 90 });
    if (trash.error) throw trash.error;
    if (!trash.data || typeof trash.data !== 'object' || Array.isArray(trash.data) || typeof trash.data.trash_id !== 'string') {
      throw new Error('League trash returned no trash id');
    }
    const id = trash.data.trash_id;
    expect((await admin.rpc('league_trash_rebuild_done', { p_trash_id: id })).error).toBeNull();
    expect((await admin.from('league_trash').update({
      deleted_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      purge_after: new Date(Date.now() - 60_000).toISOString(),
    }).eq('id', id)).error).toBeNull();
    expect((await admin.rpc('league_trash_expire', { p_now: new Date().toISOString(), p_limit: 20 })).error).toBeNull();
    expect((await admin.from('players').delete().in('id', playerIds)).error).toBeNull();
    expect((await deleteLocalRuleset(admin, rulesetId)).error).toBeNull();
  });

  async function create(bracketType: Phase['bracket_type'] = 'single_elim'): Promise<Phase> {
    return phases.createPhase({
      season_id: seasonId, name: `Native fixture ${randomUUID()}`, bracket_type: bracketType,
      ruleset_id: rulesetId, best_of_default: 3, is_doubles: false, team_visibility: 'hidden_until_match',
    });
  }

  async function enroll(phaseId: string): Promise<void> {
    expect(await phases.replacePhaseEnrollment(phaseId, playerIds.slice(0, 4).map((player_id, i) => ({ player_id, seed: i + 1 })), {
      type: 'roster', source_phase_id: null, synced_at: '2026-11-17T00:00:00Z', frozen: false,
    }, null)).toBe(true);
  }

  it('atomically deletes only the latest confirmed unplayed round and rewinds its current-round pointer', async () => {
    const phase = await create('swiss');
    const previous = await rounds.createPhaseRound({ phase_id: phase.id, name: 'Previous fixture round', round_number: 1, best_of: 1 });
    const target = await rounds.createPhaseRoundWithMatches({
      phase_id: phase.id, name: 'Latest fixture round', round_number: 2, best_of: 1,
      bye_player_ids: [playerIds[2]], matches: [{ player_1_id: playerIds[0], player_2_id: playerIds[1] }],
    });
    const args = {
      p_season_id: seasonId, p_phase_id: phase.id, p_round_id: target.id,
      p_expected_updated_at: target.updated_at, p_confirm: true,
    };
    const other = await create('swiss');
    expect((await admin.rpc('phase_admin_round_delete', { ...args, p_phase_id: other.id })).error?.message).toBe('round_not_found');
    expect((await admin.rpc('phase_admin_round_delete', { ...args, p_confirm: false })).error?.message).toBe('phase_round_delete_confirm_required');
    expect((await admin.rpc('phase_admin_round_delete', { ...args, p_expected_updated_at: '2020-01-01T00:00:00Z' })).error?.message).toBe('phase_round_delete_changed');
    await expect(rounds.deleteAdminPhaseRound(seasonId, phase.id, previous.id, previous.updated_at, true))
      .rejects.toMatchObject({ code: 'phase_round_delete_dependent' });
    expect((await phases.getPhaseById(phase.id))?.current_round).toBe(2);

    const deletions = await Promise.all([
      admin.rpc('phase_admin_round_delete', args),
      admin.rpc('phase_admin_round_delete', args),
    ]);
    expect(deletions.filter(result => result.error === null).map(result => result.data))
      .toEqual([{ name: target.name, round_number: 2, matches: 1 }]);
    expect(deletions.filter(result => result.error !== null).map(result => result.error?.message)).toEqual(['round_not_found']);
    expect((await rounds.getRoundsByPhase(phase.id)).map(round => round.id)).toEqual([previous.id]);
    expect((await admin.from('phase_matches').select('id').eq('round_id', target.id)).data).toEqual([]);
    expect(await phases.getPhaseById(phase.id)).toMatchObject({ current_round: 1, status: 'active' });
  });

  it('preserves game, prep, report and round rows on guarded deletion refusals', async () => {
    const phase = await create('swiss');
    const round = await rounds.createPhaseRoundWithMatches({
      phase_id: phase.id, name: 'Protected fixture round', round_number: 1, best_of: 1,
      matches: [{ player_1_id: playerIds[0], player_2_id: playerIds[1] }],
    });
    const match = await admin.from('phase_matches').select('id').eq('round_id', round.id).single();
    expect(match.error).toBeNull();
    if (!match.data) throw new Error('Fixture match missing');
    const matchId = match.data.id;
    const remove = () => rounds.deleteAdminPhaseRound(seasonId, phase.id, round.id, round.updated_at, true);

    expect((await admin.from('phase_games').insert({ match_id: matchId, game_number: 1 })).error).toBeNull();
    await expect(remove()).rejects.toMatchObject({ code: 'phase_round_delete_results' });
    expect((await admin.from('phase_games').select('id').eq('match_id', matchId)).data).toHaveLength(1);
    expect((await admin.from('phase_games').delete().eq('match_id', matchId)).error).toBeNull();

    expect((await admin.from('phase_match_prep_teams').insert({ match_id: matchId, player_id: playerIds[0] })).error).toBeNull();
    await expect(remove()).rejects.toMatchObject({ code: 'phase_round_delete_teams' });
    expect((await admin.from('phase_match_prep_teams').select('id').eq('match_id', matchId)).data).toHaveLength(1);
    expect((await admin.from('phase_match_prep_teams').delete().eq('match_id', matchId)).error).toBeNull();

    expect((await admin.from('phase_reports').insert({
      phase_id: phase.id, round_id: round.id, report_type: 'round_forecast', model_id: 'fixture',
    })).error).toBeNull();
    await expect(remove()).rejects.toMatchObject({ code: 'phase_round_delete_linked' });
    expect((await admin.from('phase_reports').select('id').eq('round_id', round.id)).data).toHaveLength(1);
    expect((await admin.from('phase_matches').select('id').eq('round_id', round.id)).data).toEqual([{ id: matchId }]);
    expect(await rounds.getPhaseRoundById(round.id, phase.id)).not.toBeNull();
    expect((await phases.getPhaseById(phase.id))?.current_round).toBe(1);

    const completed = await rounds.completePhaseRound(round.id, { force: true });
    expect(completed.outcome).toBe('completed');
    if (completed.outcome !== 'completed') throw new Error('Fixture round was not completed');
    await expect(rounds.deleteAdminPhaseRound(seasonId, phase.id, round.id, completed.round.updated_at, true))
      .rejects.toMatchObject({ code: 'phase_round_delete_locked' });
  });

  async function firstGeneratedRoundPlan() {
    const phase = await create('round_robin');
    await enroll(phase.id);
    const { getSeasonGroups } = await import('@/lib/supabase/queries/season-groups');
    const [live, participants, leagueGroups] = await Promise.all([
      phases.getPhaseById(phase.id), phases.getPhaseParticipants(phase.id), getSeasonGroups(seasonId),
    ]);
    if (!live) throw new Error('Native pairing phase missing after enrollment');
    const input: Parameters<typeof rounds.writeGeneratedPhaseRound>[0] = {
      phase_id: live.id, season_id: seasonId, phase_status: live.status,
      round_id: null, name: 'Round 1', round_number: 1, best_of: 3, bye_player_ids: [],
      matches: leagueGroups.map(group => ({ player_1_id: group.player_ids[0], player_2_id: group.player_ids[1] })),
      deadline: '2030-01-01T00:00:00.000Z', expected_updated_at: live.updated_at,
      replacement_groups: leagueGroups.map((group, index) => ({
        season_group_id: group.id, name: group.name, group_number: index + 1,
        members: participants.filter(player => group.player_ids.includes(player.id))
          .map((player, seed) => ({ player_id: player.id, seed: seed + 1 })),
      })),
      inputs: {
        phase: {
          status: live.status, current_round: live.current_round, bracket_type: live.bracket_type,
          stage_spec: live.stage_spec, name: live.name, bo_overrides: live.bo_overrides, best_of_default: live.best_of_default,
        },
        season: { start_date: null, format_type: 'singles' }, rounds: [], matches: [], groups: [],
        participants: participants.map(({ id, name, seed }) => ({ id, name, seed })).sort((a, b) => a.id.localeCompare(b.id)),
        league_groups: leagueGroups.map(({ id, name, sort_order, player_ids }) => ({ id, name, sort_order, player_ids: [...player_ids].sort() })),
      },
    };

    return { input, live, leagueGroups };
  }

  it('commits a generated round and its first group mirror together, once per snapshot', async () => {
    const { input, live, leagueGroups } = await firstGeneratedRoundPlan();
    await expect(rounds.writeGeneratedPhaseRound({
      ...input, matches: [...input.matches, { player_1_id: playerIds[0], player_2_id: randomUUID() }],
    })).rejects.toMatchObject({ code: '23503' });
    expect(await groups.getGroupsByPhase(live.id)).toEqual([]);
    expect(await rounds.getRoundsByPhase(live.id)).toEqual([]);
    expect((await phases.getPhaseById(live.id))?.status).toBe('upcoming');

    const attempts = await Promise.allSettled([rounds.writeGeneratedPhaseRound(input), rounds.writeGeneratedPhaseRound(input)]);
    expect(attempts.map(attempt => attempt.status).sort()).toEqual(['fulfilled', 'rejected']);
    for (const attempt of attempts) {
      if (attempt.status === 'rejected') expect(attempt.reason).toMatchObject({ code: 'round_status_changed', statusCode: 409 });
    }
    const saved = await rounds.getRoundsByPhase(live.id);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ round_number: 1, pairings_generated: true });
    expect(Date.parse(saved[0].deadline ?? '')).toBe(Date.parse(input.deadline ?? ''));
    expect((await groups.getGroupsByPhase(live.id)).map(group => group.season_group_id)).toEqual(leagueGroups.map(group => group.id));
    expect((await admin.from('phase_matches').select('id', { head: true, count: 'exact' }).eq('phase_id', live.id)).count)
      .toBe(input.matches.length);
    expect((await phases.getPhaseById(live.id))?.status).toBe('active');
  });

  it('rolls the entire batch back if its second write fails and commits only one concurrent batch', async () => {
    const { input, live, leagueGroups } = await firstGeneratedRoundPlan();
    const second = {
      ...input, round_number: 2, name: 'Round 2', deadline: '2030-01-08T00:00:00.000Z',
      matches: [{ player_1_id: playerIds[0], player_2_id: playerIds[1] }],
    };
    await expect(rounds.writeGeneratedPhaseRoundBatch(input, [
      input, { ...second, matches: [{ player_1_id: playerIds[0], player_2_id: randomUUID() }] },
    ])).rejects.toMatchObject({ code: '23503' });
    expect(await groups.getGroupsByPhase(live.id)).toEqual([]);
    expect(await rounds.getRoundsByPhase(live.id)).toEqual([]);
    expect(await phases.getPhaseById(live.id)).toMatchObject({ status: 'upcoming', current_round: 0 });

    const attempts = await Promise.allSettled([
      rounds.writeGeneratedPhaseRoundBatch(input, [input, second]),
      rounds.writeGeneratedPhaseRoundBatch(input, [input, second]),
    ]);
    expect(attempts.map(attempt => attempt.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(attempts.find(attempt => attempt.status === 'rejected')).toMatchObject({
      reason: { code: 'round_status_changed', statusCode: 409 },
    });
    const saved = await rounds.getRoundsByPhase(live.id);
    expect(saved.map(row => [row.round_number, row.pairings_generated, Date.parse(row.deadline ?? '')])).toEqual([
      [1, true, Date.parse(input.deadline ?? '')], [2, true, Date.parse(second.deadline)],
    ]);
    expect((await groups.getGroupsByPhase(live.id)).map(group => group.season_group_id)).toEqual(leagueGroups.map(group => group.id));
    const fixtures = await admin.from('phase_matches').select('id', { head: true, count: 'exact' }).eq('phase_id', live.id);
    expect(fixtures.error).toBeNull();
    expect(fixtures.count).toBe(input.matches.length + second.matches.length);
    expect(await phases.getPhaseById(live.id)).toMatchObject({ status: 'active', current_round: 2 });
  });

  it('serializes manual appends and inserts without shifting an already started phase', async () => {
    const prefix = `Placement ${randomUUID()}`;
    const input = {
      season_id: seasonId, ruleset_id: rulesetId, bracket_type: 'single_elim' as const,
      best_of_default: 3, is_doubles: false, team_visibility: 'hidden_until_match' as const,
    };
    const [a, b] = await Promise.all([
      phases.insertAdminPhase({ ...input, name: `${prefix} A` }),
      phases.insertAdminPhase({ ...input, name: `${prefix} B` }),
    ]);
    const later = a.phase.stage_order > b.phase.stage_order ? a.phase : b.phase;
    expect(Math.abs(a.phase.stage_order - b.phase.stage_order)).toBe(1);
    expect(a.shiftedIds).toEqual([]);
    expect(b.shiftedIds).toEqual([]);
    await expect(phases.insertAdminPhase({ ...input, name: later.name.toUpperCase() }))
      .rejects.toMatchObject({ code: 'PHASE_NAME_TAKEN', statusCode: 409 });

    const beforeIds = (await phases.getPhasesBySeasonId(seasonId)).map(phase => phase.id);
    const inserted = await phases.insertAdminPhase({ ...input, name: `${prefix} Inserted` }, later.stage_order);
    expect(inserted.shiftedIds).toEqual([later.id]);
    expect(inserted.phase.stage_order).toBe(later.stage_order);
    expect((await phases.getPhaseById(later.id))?.stage_order).toBe(later.stage_order + 1);
    await expect(phases.reorderPhases(seasonId, beforeIds)).rejects.toMatchObject({ code: 'PHASE_REORDER_INCOMPLETE' });
    await phases.updatePhase(later.id, { status: 'active' }, { from: 'upcoming' });
    await expect(phases.reorderPhases(seasonId, [...beforeIds.filter(id => id !== later.id), inserted.phase.id, later.id]))
      .rejects.toMatchObject({ code: 'PHASE_REORDER_LOCKED' });
    await expect(phases.insertAdminPhase({ ...input, name: `${prefix} Refused` }, inserted.phase.stage_order))
      .rejects.toMatchObject({ code: 'PHASE_INSERT_LOCKED' });
    expect((await phases.getPhaseById(inserted.phase.id))?.stage_order).toBe(inserted.phase.stage_order);
    expect((await phases.getPhaseById(later.id))?.stage_order).toBe(later.stage_order + 1);
  });

  it('confirms rounds under the delete lock, protects dependent enrollment and keeps independent cast sessions', async () => {
    const source = await create();
    const dependent = await create();
    await enroll(source.id);
    expect(await phases.replacePhaseEnrollment(dependent.id, [{ player_id: playerIds[0], seed: 1 }], {
      type: 'standings', source_phase_id: source.id, synced_at: '2026-11-17T01:00:00Z', frozen: true,
    }, null)).toBe(true);
    await expect(phases.deleteAdminPhase(randomUUID(), source.id, true))
      .rejects.toMatchObject({ code: 'PHASE_NOT_FOUND', statusCode: 404 });
    await expect(phases.deleteAdminPhase(seasonId, source.id, true))
      .rejects.toMatchObject({ code: 'PHASE_DELETE_ENROLLMENT_SOURCE', statusCode: 409 });
    await phases.deleteAdminPhase(seasonId, dependent.id, false);

    const teamId = randomUUID();
    expect((await admin.from('phase_teams').insert({ id: teamId, phase_id: source.id, season_id: seasonId, player_id: playerIds[0] })).error).toBeNull();
    await expect(phases.deleteAdminPhase(seasonId, source.id, true))
      .rejects.toMatchObject({ code: 'PHASE_DELETE_TEAMS_LINKED', statusCode: 409 });
    expect((await admin.from('phase_teams').delete().eq('id', teamId)).error).toBeNull();

    const externalSession = randomUUID();
    const ownedSession = randomUUID();
    const cast = { owner_id: playerIds[0], phase_id: source.id, season_id: seasonId };
    expect((await admin.from('cast_sessions').insert({ ...cast, id: externalSession })).error).toBeNull();
    expect((await admin.from('phase_cast_sessions').insert({ ...cast, id: ownedSession })).error).toBeNull();
    try {
      await rounds.createPhaseRound({ phase_id: source.id, name: 'Native delete round', round_number: 1, best_of: 3 });
      await expect(phases.deleteAdminPhase(seasonId, source.id, false))
        .rejects.toMatchObject({ code: 'PHASE_DELETE_CONFIRM_REQUIRED', statusCode: 400 });
      expect((await admin.from('phase_cast_sessions').select('id').eq('id', ownedSession).single()).data).toEqual({ id: ownedSession });
      await expect(phases.deleteAdminPhase(seasonId, source.id, true))
        .resolves.toEqual({ name: source.name, playerIds: [...playerIds.slice(0, 4)].sort() });
      expect(await phases.getPhaseById(source.id)).toBeNull();
      expect((await admin.from('phase_cast_sessions').select('id').eq('id', ownedSession).maybeSingle()).data).toBeNull();
      expect((await admin.from('cast_sessions').select('phase_id,phase_match_id').eq('id', externalSession).single()).data)
        .toEqual({ phase_id: null, phase_match_id: null });
    } finally {
      expect((await admin.from('cast_sessions').delete().eq('id', externalSession)).error).toBeNull();
    }
  });

  it('replaces native groups atomically and keeps the old groups when the seed snapshot changes', async () => {
    const ungrouped = randomUUID();
    expect((await admin.from('seasons').insert({
      id: ungrouped, name: 'Ungrouped fixture', format_type: 'singles', ruleset_id: rulesetId,
    })).error).toBeNull();
    let phaseId: string | undefined;
    try {
      const phase = await phases.createPhase({
        season_id: ungrouped, name: 'Native group fixture', bracket_type: 'round_robin',
        ruleset_id: rulesetId, best_of_default: 3, is_doubles: false, team_visibility: 'hidden_until_match',
      });
      phaseId = phase.id;
      await enroll(phaseId);
      const snapshot = playerIds.slice(0, 4).map((player_id, i) => ({ player_id, seed: i + 1 }));
      const plan = [
        { name: 'Group A', members: [playerIds[0], playerIds[3]] },
        { name: 'Group B', members: [playerIds[1], playerIds[2]] },
      ];
      await groups.replaceAdminPhaseGroups(ungrouped, phaseId, plan, snapshot);
      const saved = await groups.getGroupsByPhase(phaseId);
      expect(saved.map(({ name, members }) => ({ name, members: members.map(m => m.player_id) }))).toEqual(plan);
      await phases.updatePhaseParticipantSeeds(phaseId, [{ player_id: playerIds[0], seed: 5 }]);
      await expect(groups.replaceAdminPhaseGroups(ungrouped, phaseId, plan, snapshot))
        .rejects.toMatchObject({ code: 'GROUP_SLOT_CHANGED', statusCode: 409 });
      expect((await groups.getGroupsByPhase(phaseId)).map(group => group.id)).toEqual(saved.map(group => group.id));
      await groups.replaceAdminPhaseGroups(ungrouped, phaseId, [], []);
      expect(await groups.getGroupsByPhase(phaseId)).toEqual([]);
    } finally {
      if (phaseId) await phases.deleteAdminPhase(ungrouped, phaseId, false);
      expect((await admin.from('seasons').delete().eq('id', ungrouped)).error).toBeNull();
    }
  });

  it('serializes enrollment CAS and changes seeds atomically without tournament rows', async () => {
    const phase = await create();
    const attempts = await Promise.all([0, 1].map((i) => phases.replacePhaseEnrollment(phase.id,
      [{ player_id: playerIds[i], seed: 1 }], {
        type: 'roster', source_phase_id: null, synced_at: `2026-11-17T00:00:0${i}Z`, frozen: false,
      }, null)));
    expect(attempts.filter(Boolean)).toHaveLength(1);
    expect(await phases.getPhaseParticipants(phase.id)).toHaveLength(1);
    const untouched = await admin.from('tournaments').select('id').eq('id', phase.id);
    expect(untouched.error).toBeNull();
    expect(untouched.data).toEqual([]);

    const seeded = await create();
    await enroll(seeded.id);
    await phases.updatePhaseParticipantSeeds(seeded.id, [
      { player_id: playerIds[0], seed: 2 }, { player_id: playerIds[1], seed: 1 },
    ]);
    const participants = await phases.getPhaseParticipants(seeded.id);
    expect(participants.find((p) => p.id === playerIds[0])?.seed).toBe(2);
    expect(participants.find((p) => p.id === playerIds[1])?.seed).toBe(1);
  });

  it('keeps retained group slots across enrollment sync and refuses removal after scheduling', async () => {
    const phase = await create('double_elim');
    await enroll(phase.id);
    const [group] = await groups.createPhaseGroupBatch([{
      phase_id: phase.id, season_id: seasonId, season_group_id: null, name: 'Example group', group_number: 1,
    }]);
    await groups.addPhaseGroupMembersBatch(playerIds.slice(0, 3).map((player_id, index) => ({
      phase_id: phase.id, group_id: group.id, player_id, seed: index + 10,
    })));
    const nextSync = '2026-11-17T00:01:00Z';
    const entries = [
      { player_id: playerIds[0], seed: 2 },
      { player_id: playerIds[1], seed: 1 },
    ];
    const slots = () => groups.getGroupMembershipsInPhase(phase.id, playerIds);
    expect(await phases.replacePhaseEnrollment(phase.id, entries, {
      type: 'roster', source_phase_id: null, synced_at: nextSync, frozen: false,
    }, '2026-11-17T00:00:00Z')).toBe(true);
    expect(await slots()).toEqual(expect.arrayContaining([
      expect.objectContaining({ player_id: playerIds[0], group_id: group.id, seed: 10 }),
      expect.objectContaining({ player_id: playerIds[1], group_id: group.id, seed: 11 }),
    ]));
    expect(await slots()).toHaveLength(2);
    expect((await phases.getPhaseParticipants(phase.id)).map(player => [player.id, player.seed]))
      .toEqual([[playerIds[1], 1], [playerIds[0], 2]]);

    await rounds.createPhaseRound({ phase_id: phase.id, name: 'Finals', round_number: 1, best_of: 3 });
    const scheduledSlots = await slots();
    const scheduled = await phases.getPhaseById(phase.id);
    await phases.updatePhaseParticipantSeeds(phase.id, [{ player_id: playerIds[0], seed: 2, starting_bracket: 'losers' }]);
    const forcedSync = '2026-11-17T00:02:00Z';
    expect(await phases.replacePhaseEnrollment(phase.id, entries, {
      type: 'roster', source_phase_id: null, synced_at: forcedSync, frozen: false,
    }, nextSync, true)).toBe(true);
    expect((await phases.getPhaseParticipants(phase.id)).find(player => player.id === playerIds[0]))
      .toMatchObject({ seed: 2, starting_bracket: 'losers' });
    await expect(phases.removePhaseParticipant(phase.id, playerIds[0])).rejects.toMatchObject({
      code: 'PHASE_GROUP_ROSTER_SCHEDULED', statusCode: 409,
    });
    await expect(phases.replacePhaseEnrollment(phase.id, entries.slice(1), {
      type: 'roster', source_phase_id: null, synced_at: '2026-11-17T00:03:00Z', frozen: false,
    }, forcedSync, true)).rejects.toMatchObject({ code: 'PHASE_GROUP_ROSTER_SCHEDULED', statusCode: 409 });
    expect(await slots()).toEqual(scheduledSlots);
    expect((await phases.getPhaseById(phase.id))?.enrollment_source)
      .toMatchObject({ ...scheduled?.enrollment_source, synced_at: forcedSync, frozen: true });
    expect(await phases.getPhaseParticipants(phase.id)).toHaveLength(2);
  });

  it('admits one competing first round and one competing status move', async () => {
    const phase = await create();
    await enroll(phase.id);
    const writes = await Promise.allSettled([0, 1].map(() => rounds.createPhaseRoundWithMatches({
      phase_id: phase.id, name: 'Round 1', round_number: 1, best_of: 3,
      matches: [{ player_1_id: playerIds[0], player_2_id: playerIds[1] }],
    })));
    expect(writes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = writes.find((r) => r.status === 'rejected');
    expect(refused?.status === 'rejected' && refused.reason instanceof rounds.RoundAlreadyWrittenError).toBe(true);
    expect(await rounds.getRoundsByPhase(phase.id)).toHaveLength(1);
    expect((await phases.getPhaseById(phase.id))?.status).toBe('active');

    const racing = await create();
    const changes = await Promise.allSettled([
      phases.updatePhase(racing.id, { status: 'active' }, { from: 'upcoming' }),
      phases.updatePhase(racing.id, { status: 'completed' }, { from: 'upcoming' }),
    ]);
    expect(changes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(changes.find((r) => r.status === 'rejected')).toMatchObject({ reason: { code: 'tournament_status_changed' } });
  });

  it('creates an empty round without starting the phase or advancing its counter', async () => {
    const phase = await create();
    await enroll(phase.id);
    const round = await rounds.createPhaseRound({ phase_id: phase.id, name: 'Finals', round_number: 1, best_of: 3 });
    expect(round.status).toBe('pending');
    expect((await phases.getPhaseById(phase.id))).toMatchObject({
      status: 'upcoming', current_round: 0, enrollment_source: { frozen: false },
    });
  });

  it('rejects a stale league-group mirror before the first round and cascades a substitute slot', async () => {
    const phase = await create('round_robin');
    await enroll(phase.id);
    const created = await groups.createPhaseGroupBatch(leagueGroupIds.map((season_group_id, i) => ({
      phase_id: phase.id, season_id: seasonId, season_group_id, name: `Native ${i}`, group_number: i + 1,
    })));
    await groups.addPhaseGroupMembersBatch(playerIds.slice(0, 3).map((player_id, i) => ({
      phase_id: phase.id, group_id: created[i % 2].id, player_id, seed: i + 1,
    })));
    const write = () => rounds.createPhaseRoundWithMatches({
      phase_id: phase.id, name: 'Round 1', round_number: 1, best_of: 3, matches: [],
    });
    await expect(write()).rejects.toMatchObject({ code: 'PHASE_GROUPS_STALE' });
    await groups.addPhaseGroupMember(phase.id, created[1].id, playerIds[3], 4);
    await write();
    await phases.swapPhaseParticipant(phase.id, playerIds[0], playerIds[4]);
    const moved = await groups.getGroupMembershipsInPhase(phase.id, [playerIds[0], playerIds[4]]);
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ player_id: playerIds[4], group_id: created[0].id });
  });

  it('refuses a bracket planned from stale settings or seeds before creating rounds', async () => {
    const phase = await create();
    await enroll(phase.id);
    const snapshot = (await phases.getPhaseById(phase.id))!;
    const participants = await phases.getPhaseParticipants(phase.id);
    const [{ generateEliminationBracket }, { createNativeBracketPersistence }] = await Promise.all([
      import('@/lib/tournament/bracket-generate'), import('../bracket-persistence'),
    ]);
    const planned = (updatedAt: string, roster = participants) => createNativeBracketPersistence(undefined, {
      updatedAt, seeds: roster.map(({ id: player_id, seed, starting_bracket }) => ({ player_id, seed, starting_bracket })),
    });
    await phases.updatePhase(phase.id, { best_of_default: 5 }, { from: 'upcoming' });
    await expect(generateEliminationBracket(snapshot, participants, {}, planned(snapshot.updated_at)))
      .rejects.toMatchObject({ code: 'phase_bracket_inputs_changed', statusCode: 409 });

    await phases.updatePhaseParticipantSeeds(phase.id, [{ player_id: playerIds[0], seed: 5 }]);
    const current = (await phases.getPhaseById(phase.id))!;
    await expect(generateEliminationBracket(current, participants, {}, planned(current.updated_at)))
      .rejects.toMatchObject({ code: 'phase_bracket_inputs_changed', statusCode: 409 });
    expect(await rounds.getRoundsByPhase(phase.id)).toEqual([]);
    const roster = await phases.getPhaseParticipants(phase.id);
    await expect(generateEliminationBracket(current, roster, {}, planned(current.updated_at, roster)))
      .resolves.toMatchObject({ rounds_created: 2, matches_materialized: 2 });
    expect((await rounds.getRoundsByPhase(phase.id)).every(round => round.best_of === 5)).toBe(true);
  });

  it('commits either the whole native bracket or the competing completion', async () => {
    const phase = await create();
    await enroll(phase.id);
    const [{ generateEliminationBracket }, { createNativeBracketPersistence }] = await Promise.all([
      import('@/lib/tournament/bracket-generate'), import('../bracket-persistence'),
    ]);
    const storage = createNativeBracketPersistence({
      getMatches: async () => { throw new Error('Fresh bracket must not load results'); },
      getMatch: async () => { throw new Error('Fresh bracket must not load results'); },
      resetMatch: async () => { throw new Error('Fresh bracket must not reset results'); },
    });
    const participants = await phases.getPhaseParticipants(phase.id);
    const attempts = await Promise.allSettled([
      generateEliminationBracket(phase, participants, {}, storage),
      phases.updatePhase(phase.id, { status: 'completed' }, { from: 'upcoming' }),
    ]);
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const finalPhase = await phases.getPhaseById(phase.id);
    const writtenRounds = await rounds.getRoundsByPhase(phase.id);
    const matches = await admin.from('phase_matches').select('id').eq('phase_id', phase.id);
    expect(matches.error).toBeNull();
    expect(writtenRounds).toHaveLength(finalPhase?.status === 'active' ? 2 : 0);
    expect(matches.data).toHaveLength(finalPhase?.status === 'active' ? 2 : 0);
  });
});
