import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tables } from '@/types/database';

const q = vi.hoisted(() => {
  type Result = { data?: unknown; error: unknown; count?: number };
  const results: Result[] = [];
  const next = () => Promise.resolve(results.shift() ?? { data: null, error: null });
  const builder = {
    select: vi.fn(), eq: vi.fn(), order: vi.fn(), update: vi.fn(), insert: vi.fn(), delete: vi.fn(),
    range: vi.fn(next), single: vi.fn(next), maybeSingle: vi.fn(next),
    then: (resolve: (result: Result) => unknown, reject: (error: unknown) => unknown) => next().then(resolve, reject),
  };
  for (const method of [builder.select, builder.eq, builder.order, builder.update, builder.insert, builder.delete]) method.mockReturnValue(builder);
  return { results, builder, from: vi.fn(() => builder), getPhaseById: vi.fn() };
});
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: q.from } }));
vi.mock('../league-phases', () => q);

import { clearPhaseCastSessionsMatchPointer, createPhaseCastSession, deletePhaseCastSession, getPhaseCastSessionById, listPhaseCastSessions, updatePhaseCastSession } from '../phase-cast-sessions';
import { toPublicPhaseCastSession } from '@/lib/broadcast/phase-session-view';

const row = {
  id: 'session', owner_id: 'creator', realtime_key: 'private-capability', phase_id: 'phase', season_id: 'league', match_id: 'match',
  name: 'Fixture session', mode: 'cast', status: 'draft', player1_id: null, player1_name: null, player1_avatar_url: null,
  player2_id: null, player2_name: null, player2_avatar_url: null, player1_team: [], player2_team: [], tracker_state: {},
  overlay_config: {}, caster_notes: { match: 'private notes' }, format: 'gen9ou', generation: 9, created_at: 'created', updated_at: '2026-01-01T00:00:00.000Z',
  phase: { season_id: 'league' }, match: { id: 'match', phase_id: 'phase' },
} satisfies Tables<'phase_cast_sessions'> & { phase: { season_id: string }; match: { id: string; phase_id: string } };

beforeEach(() => {
  vi.clearAllMocks();
  q.results.length = 0;
  q.getPhaseById.mockResolvedValue({ id: 'phase', season_id: 'league' });
});

describe('native phase cast persistence', () => {
  it('derives the parent league and leaves realtime key generation to the database', async () => {
    q.results.push({ data: row, error: null });
    const created = await createPhaseCastSession('creator', { phase_id: 'phase', match_id: 'match' });
    expect(created).toMatchObject({ phase_id: 'phase', season_id: 'league' });
    expect(created).not.toHaveProperty('tournament_id');
    expect(q.builder.insert).toHaveBeenCalledWith(expect.objectContaining({ owner_id: 'creator', phase_id: 'phase', season_id: 'league', status: 'draft' }));
    expect(q.builder.insert.mock.calls[0][0]).not.toHaveProperty('realtime_key');
    expect(q.builder.insert.mock.calls[0][0]).not.toHaveProperty('tournament_id');
  });

  it('lists only the creator scope and pages completely', async () => {
    q.results.push({ data: [row], error: null }, { data: [], error: null });
    await expect(listPhaseCastSessions('creator', 'phase')).resolves.toHaveLength(1);
    expect(q.builder.eq).toHaveBeenCalledWith('owner_id', 'creator');
    expect(q.builder.eq).toHaveBeenCalledWith('phase_id', 'phase');
    expect(q.builder.range.mock.calls).toEqual([[0, 999], [1, 1000]]);
  });

  it('checks the machine and guards the captured owner, phase, status and version', async () => {
    q.results.push({ data: row, error: null });
    const current = await getPhaseCastSessionById('session');
    if (!current) throw new Error('Missing session fixture');
    q.results.push({ data: { ...row, status: 'live' }, error: null });
    await expect(updatePhaseCastSession(current, { status: 'live' }, 'owner')).resolves.toMatchObject({ status: 'live' });
    for (const pair of [['owner_id', 'creator'], ['phase_id', 'phase'], ['status', 'draft'], ['updated_at', row.updated_at]]) {
      expect(q.builder.eq).toHaveBeenCalledWith(...pair);
    }
    q.results.push({ data: null, error: null });
    await expect(updatePhaseCastSession(current, { status: 'archived' }, 'owner')).resolves.toBeNull();
    await expect(updatePhaseCastSession({ ...current, status: 'archived' }, { status: 'live' }, 'owner'))
      .rejects.toMatchObject({ code: 'state_transition_invalid' });
  });

  it('retargets a phase with its real league and refuses unknown parents', async () => {
    q.results.push({ data: row, error: null });
    const current = await getPhaseCastSessionById('session');
    if (!current) throw new Error('Missing session fixture');
    q.getPhaseById.mockResolvedValue({ id: 'other-phase', season_id: 'other-league' });
    q.results.push({ data: null, error: null });
    await updatePhaseCastSession(current, { phase_id: 'other-phase', match_id: null }, 'owner');
    expect(q.builder.update).toHaveBeenCalledWith(expect.objectContaining({ phase_id: 'other-phase', season_id: 'other-league', match_id: null }));
    q.getPhaseById.mockResolvedValue(null);
    await expect(createPhaseCastSession('creator', { phase_id: 'missing' })).rejects.toMatchObject({ code: 'INVALID_PHASE_ID' });
  });

  it('advances the version even when the captured timestamp is ahead of the clock', async () => {
    q.results.push({ data: { ...row, updated_at: '2099-01-01T00:00:00.000Z' }, error: null });
    const current = await getPhaseCastSessionById('session');
    if (!current) throw new Error('Missing session fixture');
    q.results.push({ data: null, error: null });
    await updatePhaseCastSession(current, { name: 'Changed' }, 'owner');
    expect(q.builder.update).toHaveBeenCalledWith(expect.objectContaining({ updated_at: '2099-01-01T00:00:00.001Z' }));
  });

  it('preserves sessions during match cleanup and reports guarded deletion races', async () => {
    q.results.push({ data: row, error: null });
    const current = await getPhaseCastSessionById('session');
    if (!current) throw new Error('Missing session fixture');
    q.results.push({ count: 2, error: null }, { data: [], error: null });
    await expect(clearPhaseCastSessionsMatchPointer('match')).resolves.toBe(2);
    expect(q.builder.update).toHaveBeenCalledWith({ match_id: null }, { count: 'exact' });
    await expect(deletePhaseCastSession(current)).resolves.toBe(false);
  });

  it('never puts capability keys, private sets, tracker state or notes in the public view', async () => {
    q.results.push({ data: row, error: null });
    const session = await getPhaseCastSessionById('session');
    if (!session) throw new Error('Missing session fixture');
    const view = toPublicPhaseCastSession(session);
    for (const key of ['owner_id', 'realtime_key', 'player1_team', 'player2_team', 'tracker_state', 'overlay_config', 'caster_notes']) {
      expect(view).not.toHaveProperty(key);
    }
    expect(view).toMatchObject({ id: 'session', phase_id: 'phase', match_id: 'match' });
  });

  it('propagates unexpected storage failures', async () => {
    q.results.push({ data: null, error: new Error('cast failed') });
    await expect(getPhaseCastSessionById('session')).rejects.toThrow('cast failed');
  });

  it('rejects mismatched owners and derives the league for a retained nullable season', async () => {
    q.results.push(
      { data: { ...row, phase: { season_id: 'wrong' } }, error: null },
      { data: { ...row, match: { ...row.match, phase_id: 'wrong' } }, error: null },
      { data: { ...row, season_id: null }, error: null },
    );
    await expect(getPhaseCastSessionById('session')).rejects.toThrow('Invalid native cast session ownership');
    await expect(getPhaseCastSessionById('session')).rejects.toThrow('Invalid native cast session ownership');
    await expect(getPhaseCastSessionById('session')).resolves.toMatchObject({ season_id: 'league' });
  });
});
