import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockBuilder } = vi.hoisted(() => {
  const mb: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ['from', 'update', 'eq', 'select']) {
    mb[method] = vi.fn().mockReturnValue(mb);
  }
  mb.single = vi.fn();
  mb.maybeSingle = vi.fn();
  return { mockBuilder: mb };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: mockBuilder }));

import { updateCastSession, updateCastSessionFromStatus } from '../cast-sessions';

const ID = '9f2cf170-09cd-49c8-81a4-9898aefdcd21';
const row = {
  id: ID,
  owner_id: 'player-1',
  realtime_key: 'key',
  match_id: null,
  tournament_id: null,
  season_id: null,
  name: 'Test Session',
  mode: 'cast',
  status: 'live',
  player1_id: null,
  player1_name: null,
  player1_avatar_url: null,
  player2_id: null,
  player2_name: null,
  player2_avatar_url: null,
  player1_team: [],
  player2_team: [],
  tracker_state: null,
  overlay_config: {},
  caster_notes: {},
  format: 'gen9ou',
  generation: 9,
  created_at: '2026-04-07T00:00:00.000Z',
  updated_at: '2026-04-07T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const method of ['from', 'update', 'eq', 'select']) mockBuilder[method].mockReturnValue(mockBuilder);
});

describe('queries/cast-sessions status writes', () => {
  it('updateCastSession writes by id only', async () => {
    mockBuilder.single.mockResolvedValue({ data: row, error: null });
    await updateCastSession(ID, { name: 'Renamed' });
    expect(mockBuilder.eq.mock.calls).toEqual([['id', ID]]);
    expect(mockBuilder.update.mock.calls[0][0]).toMatchObject({ name: 'Renamed' });
  });

  it('updateCastSessionFromStatus guards the write with the status the caller read', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: row, error: null });
    const updated = await updateCastSessionFromStatus(ID, { status: 'live' }, 'draft');
    expect(mockBuilder.eq.mock.calls).toEqual([['id', ID], ['status', 'draft']]);
    expect(mockBuilder.update.mock.calls[0][0]).toMatchObject({ status: 'live' });
    expect(updated?.status).toBe('live');
  });

  it('updateCastSessionFromStatus returns null when the status moved on', async () => {
    mockBuilder.maybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await updateCastSessionFromStatus(ID, { status: 'live' }, 'draft')).toBeNull();
  });

  it('updateCastSessionFromStatus rethrows a query error', async () => {
    const error = new Error('boom');
    mockBuilder.maybeSingle.mockResolvedValue({ data: null, error });
    await expect(updateCastSessionFromStatus(ID, { status: 'live' }, 'draft')).rejects.toBe(error);
  });
});
