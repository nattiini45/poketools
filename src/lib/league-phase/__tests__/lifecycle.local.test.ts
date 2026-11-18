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
    const phase = await create();
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
    await expect(phases.removePhaseParticipant(phase.id, playerIds[0])).rejects.toMatchObject({
      code: 'PHASE_GROUP_ROSTER_SCHEDULED', statusCode: 409,
    });
    await expect(phases.replacePhaseEnrollment(phase.id, entries.slice(1), {
      type: 'roster', source_phase_id: null, synced_at: '2026-11-17T00:02:00Z', frozen: false,
    }, nextSync, true)).rejects.toMatchObject({ code: 'PHASE_GROUP_ROSTER_SCHEDULED', statusCode: 409 });
    expect(await slots()).toEqual(scheduledSlots);
    expect((await phases.getPhaseById(phase.id))?.enrollment_source).toEqual(scheduled?.enrollment_source);
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
