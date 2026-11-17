import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { lastSqlFunction } from '@/test/sql-functions';

const db = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/client', () => ({ supabase: db }));
vi.mock('@/lib/revalidation', () => ({ expireSeasonReads: vi.fn() }));

import { PRESETS } from '@/lib/format-kit';
import { expireSeasonReads } from '@/lib/revalidation';
import { legacyFormatStorage, nativeFormatStorage } from '../format-storage';
import type { AttachRpcInput } from '@/lib/supabase/queries/season-formats';

const seasonId = '11111111-1111-4111-8111-111111111111';
const input: AttachRpcInput = {
  seasonId,
  definitionId: '22222222-2222-4222-8222-222222222222',
  versionNo: 1,
  spec: PRESETS[0].definition,
  specHash: 'a'.repeat(64),
  seed: 'fixture-seed',
  stages: [],
  presetRulesets: {},
  confirmClear: true,
  confirmedCounts: { links: 1, items: 2, submissions: 3, adjustments: 4 },
};

beforeEach(() => {
  vi.clearAllMocks();
  db.rpc.mockResolvedValue({ data: { stages: [], removed_stage_ids: [], removed_ruleset_ids: [] }, error: null });
});

describe('explicit format materialisation storage', () => {
  it('keeps the default legacy RPC and performs no generation read', async () => {
    await legacyFormatStorage.attach(input);
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith('format_attach_season', expect.objectContaining({ p_season_id: seasonId, p_confirmed_counts: input.confirmedCounts }));
    expect(db.from).not.toHaveBeenCalled();
  });

  it('selects native RPCs only through the native adapter, preserving clear confirmation', async () => {
    await nativeFormatStorage.attach(input);
    await nativeFormatStorage.detach(seasonId, true, input.confirmedCounts);
    expect(db.rpc.mock.calls.map(([name]) => name)).toEqual(['phase_format_attach_season', 'phase_format_detach_season']);
    expect(db.rpc).toHaveBeenLastCalledWith('phase_format_detach_season', {
      p_season_id: seasonId, p_confirm_clear: true, p_confirmed_counts: input.confirmedCounts,
    });
    expect(db.from).not.toHaveBeenCalled();
  });

  it('reads native round and status signals without tournament embeds', async () => {
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({
      data: { status: 'upcoming', league_phases: [{ status: 'upcoming', phase_rounds: [{ count: 1 }] }] }, error: null,
    }) };
    db.from.mockReturnValue(query);
    expect(await nativeFormatStorage.startSignals(seasonId)).toEqual({ status: 'upcoming', phases: [{ status: 'upcoming', rounds_total: 1 }] });
    expect(query.select).toHaveBeenCalledWith('status, league_phases ( status, phase_rounds ( count ) )');
  });

  it('never invents tournament cache scopes for native phase ids', () => {
    nativeFormatStorage.invalidate(seasonId, ['phase-1']);
    expect(expireSeasonReads).toHaveBeenCalledExactlyOnceWith(seasonId);
  });
});

describe('native materialisation SQL contract', () => {
  const sql = readFileSync('supabase/migrations/20261117111000_phase_format_materialisation.sql', 'utf8');

  it('keeps the explicitly supplied unfenced event writer league-scoped', () => {
    for (const name of ['format_fire_event_notify', 'format_fire_event', 'format__apply_ops', 'format__check_revision', 'format__insert_item']) {
      expect(lastSqlFunction(name).body).not.toMatch(/public\.(?:tournaments|tournament_participants|rounds)\b/);
    }
    const fire = lastSqlFunction('format_fire_event').body;
    expect(fire).toMatch(/IF p_fence_match IS NOT NULL THEN PERFORM 1 FROM public\.matches/);
    expect(fire).toContain('format__check_revision(p_season_id, p_expected_revision)');
    expect(fire).toContain('ON CONFLICT (season_id, event_key) DO NOTHING');
  });

  it('writes only native phase parents and checks native rounds under ordered row locks', () => {
    expect(sql).toContain('INSERT INTO public.league_phases');
    expect(sql).toContain('DELETE FROM public.league_phases');
    expect(sql).toContain('public.phase_rounds r WHERE r.phase_id = t.id');
    expect(sql).toContain('ORDER BY p.id FOR UPDATE');
    expect(sql).not.toMatch(/(?:INSERT INTO|DELETE FROM|UPDATE) public\.tournaments/);
    expect(sql).toContain('ON CONFLICT (season_id, format_stage_key, format_group)');
  });

  it('keeps preset definitions pinned in either store or a recycle-bin snapshot', () => {
    expect(sql).toContain('FROM public.league_phases p JOIN public.ruleset_definition_versions');
    expect(sql).toContain('FROM public.tournaments t JOIN public.ruleset_definition_versions');
    expect(sql).toContain('FROM public.league_trash_rulesets j JOIN public.ruleset_definition_versions');
  });

  it('does not redefine legacy RPCs or weaken the dormant write fence', () => {
    expect(sql.match(/AS \$\$/g)).toHaveLength(6);
    expect(sql.match(/END \$\$;/g)).toHaveLength(5);
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.(?:format_attach_season|format_detach_season|competition_create_from_format)\(/);
    expect(sql.match(/current_user <> 'postgres' AND public.phase_storage_mode\(\) IS DISTINCT FROM 'phase'/g)).toHaveLength(3);
    for (const name of ['phase_format_attach_season', 'phase_format_detach_season', 'phase_competition_create_from_format']) {
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^;]+ FROM PUBLIC, anon, authenticated;`));
    }
    expect(sql).not.toContain('SECURITY DEFINER');
    expect(sql).not.toMatch(/SET search_path = public AS/);
  });
});
