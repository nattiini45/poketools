/**
 * #50 through the route: the drafted roster of the signed-in player. The validators are real; the database reads are
 * faked (trackers, lines, picks). The pipeline in detail is in `src/lib/team/__tests__/check.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  AuthError: class AuthError extends Error {},
}));
vi.mock('@/lib/supabase/queries/rulesets', () => ({ getRulesetById: vi.fn() }));
vi.mock('@/lib/ruleset-studio/exposure', () => ({ readExposedRuleset: vi.fn() }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: vi.fn(), getParticipantCore: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: vi.fn() }));
vi.mock('@/lib/supabase/queries/drafts', () => ({
  getDraftPoolBySeason: vi.fn(),
  getDraftPoolBySeasonGroup: vi.fn(),
  getPicksByPlayer: vi.fn(),
  GroupedLeaguePoolLookupError: class GroupedLeaguePoolLookupError extends Error {},
}));
vi.mock('@/lib/supabase/queries/season-groups', () => ({ getSeasonGroupOfPlayer: vi.fn() }));
vi.mock('@/lib/supabase/queries/evolutions', () => ({ getPlayerTrackers: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-rules', () => ({ getFormatRules: vi.fn() }));
vi.mock('@/lib/draft/epb-thresholds', () => ({ getSeasonLineThresholds: vi.fn() }));

import { POST } from '../route';
import { requirePlayer } from '@/lib/auth/helpers';
import { readExposedRuleset } from '@/lib/ruleset-studio/exposure';
import { getParticipantCore, getSeasonById } from '@/lib/supabase/queries/seasons';
import { getDraftPoolBySeason, getPicksByPlayer } from '@/lib/supabase/queries/drafts';
import { getPlayerTrackers } from '@/lib/supabase/queries/evolutions';
import { getFormatRules } from '@/lib/supabase/queries/format-rules';
import { getSeasonLineThresholds } from '@/lib/draft/epb-thresholds';
import { makeRequest } from '@/lib/__tests__/helpers/api-request';
import { makeRuleset } from '@/test/ruleset-fixtures';
import { makeSet } from '@/test/team-fixtures';

const RULESET_ID = '00000000-0000-4000-8000-000000000001';
const SEASON_ID = '00000000-0000-4000-8000-000000000002';
const PLAYER = { playerId: '00000000-0000-4000-8000-000000000010' };

const SAMUROTT = makeSet('Samurott', { ability: 'Torrent', moves: ['Surf'], item: 'Mystic Water' });
const SAMUROTT_HISUI = makeSet('Samurott-Hisui', { ability: 'Sharpness', moves: ['Ceaseless Edge'], item: 'Choice Band' });

const LINES = [
  { line_id: 'oshawott-samurott', base_pokemon: 'Oshawott', stage2_pokemon: 'Dewott', stage3_pokemon: 'Samurott', stage2_kos: 3, stage3_kos: 8 },
  { line_id: 'oshawott-samurott-hisui', base_pokemon: 'Oshawott', stage2_pokemon: 'Dewott-Hisui', stage3_pokemon: 'Samurott-Hisui', stage2_kos: 3, stage3_kos: 8 },
];
const tracker = (line_id: string) => ({ line_id, base_pokemon: 'Oshawott', locked_stage3_pokemon: null, total_kos: 0 }) as never;

const validate = async (pokemon: unknown[]) => {
  const res = await POST(makeRequest({ pokemon, ruleset_id: RULESET_ID, season_id: SEASON_ID }));
  return (await res.json()) as { success: boolean; data: { valid: boolean; team_issue_details: { code?: string; params?: { species?: string } }[] } };
};
const notOwned = (body: Awaited<ReturnType<typeof validate>>) =>
  body.data.team_issue_details.filter((i) => i.code === 'not_in_roster').map((i) => i.params?.species);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requirePlayer).mockResolvedValue(PLAYER as never);
  vi.mocked(readExposedRuleset).mockResolvedValue(makeRuleset({ id: RULESET_ID, clauses: ['Species Clause'] }));
  vi.mocked(getParticipantCore).mockResolvedValue(null);
  vi.mocked(getDraftPoolBySeason).mockResolvedValue(null);
  vi.mocked(getFormatRules).mockResolvedValue(null);
});

describe('POST /api/validate-team: Evolution Point Buy roster', () => {
  beforeEach(() => {
    vi.mocked(getSeasonById).mockResolvedValue({ id: SEASON_ID, format_type: 'evolution_point_buy' } as never);
    vi.mocked(getSeasonLineThresholds).mockResolvedValue(LINES as never);
  });

  it('an Oshawott trainer fields Samurott without a "not in roster" error', async () => {
    vi.mocked(getPlayerTrackers).mockResolvedValue([tracker('oshawott-samurott')]);
    const body = await validate([SAMUROTT]);
    expect(notOwned(body)).toEqual([]);
    expect(body.data.valid).toBe(true);
  });

  it('Samurott-Hisui is the other line’s: owned only when that line is held', async () => {
    vi.mocked(getPlayerTrackers).mockResolvedValue([tracker('oshawott-samurott')]);
    expect(notOwned(await validate([SAMUROTT_HISUI]))).toEqual(['Samurott-Hisui']);

    vi.mocked(getPlayerTrackers).mockResolvedValue([tracker('oshawott-samurott-hisui')]);
    expect(notOwned(await validate([SAMUROTT_HISUI]))).toEqual([]);
  });

  it('after a Redraft a dropped line is reported, a newly drafted line is accepted', async () => {
    vi.mocked(getPlayerTrackers).mockResolvedValue([]); // dropped Oshawott, nothing else held, but they still have picks
    vi.mocked(getDraftPoolBySeason).mockResolvedValue({ id: 'pool-1' } as never);
    vi.mocked(getPicksByPlayer).mockResolvedValue([]);
    expect(notOwned(await validate([SAMUROTT]))).toEqual(['Samurott']);

    vi.mocked(getPlayerTrackers).mockResolvedValue([tracker('oshawott-samurott')]); // redraft pick of the line
    expect(notOwned(await validate([SAMUROTT]))).toEqual([]);
  });
});

describe('POST /api/validate-team: other draft leagues', () => {
  beforeEach(() => {
    vi.mocked(getSeasonById).mockResolvedValue({ id: SEASON_ID, format_type: 'draft' } as never);
  });

  it('a pick that was voided is not owned (the roster read returns live picks only)', async () => {
    vi.mocked(getDraftPoolBySeason).mockResolvedValue({ id: 'pool-1' } as never);
    // `getPicksByPlayer` filters `voided_at`; the route trusts it, so a voided Samurott is simply absent.
    vi.mocked(getPicksByPlayer).mockResolvedValue([{ pokemon_name: 'Garchomp' } as never]);

    expect(notOwned(await validate([SAMUROTT]))).toEqual(['Samurott']);
    expect(getPicksByPlayer).toHaveBeenCalledWith('pool-1', PLAYER.playerId);
  });
});
