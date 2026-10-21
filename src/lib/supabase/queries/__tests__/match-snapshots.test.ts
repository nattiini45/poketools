import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: mockRpc },
}));

import { insertMatchSnapshots, type SnapshotInput } from '../match-snapshots';

function row(overrides: Partial<SnapshotInput> = {}): SnapshotInput {
  return {
    match_id: 'match-1',
    player_id: 'player-1',
    tracker_id: 'tracker-1',
    base_pokemon: 'Oshawott',
    species_at_match: 'Oshawott',
    stage_at_match: 1,
    ...overrides,
  };
}

interface RpcPayloadRow {
  tracker_id: string | null;
  base_pokemon: string;
  line_id: string | null;
}

function sentRows(): RpcPayloadRow[] {
  const [name, args] = mockRpc.mock.calls[0] as [string, { p_match_id: string; p_snapshots: RpcPayloadRow[] }];
  expect(name).toBe('epb_replace_match_snapshots');
  expect(args.p_match_id).toBe('match-1');
  return args.p_snapshots;
}

describe('insertMatchSnapshots', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockRpc.mockResolvedValue({ data: null, error: null });
  });

  it('sends each line of a branched base with its own line_id', async () => {
    await insertMatchSnapshots('match-1', [
      row({ tracker_id: 't-samurott', line_id: 'oshawott--samurott' }),
      row({ tracker_id: 't-hisui', line_id: 'oshawott--samurotthisui' }),
    ]);
    expect(sentRows().map((r) => [r.tracker_id, r.base_pokemon, r.line_id])).toEqual([
      ['t-samurott', 'Oshawott', 'oshawott--samurott'],
      ['t-hisui', 'Oshawott', 'oshawott--samurotthisui'],
    ]);
  });

  it('sends line_id null for a legacy row without a line', async () => {
    await insertMatchSnapshots('match-1', [row({ base_pokemon: 'Gastly', species_at_match: 'Gastly' })]);
    expect(sentRows()[0].line_id).toBeNull();
  });

  it('throws the RPC error', async () => {
    const err = Object.assign(new Error('boom'), { code: 'P0001' });
    mockRpc.mockResolvedValue({ data: null, error: err });
    await expect(insertMatchSnapshots('match-1', [row()])).rejects.toBe(err);
  });
});
