/**
 * Point-buy leagues share one battle ruleset row (src/lib/season/point-buy-battle-ruleset.ts).
 * The teambuilder's live check resolves that row and ANDs `validateTeam()` against it with the
 * point-buy validator, so the row must not carry bans of its own: a ban the season lifted in
 * its `format_rules` must not still reject the team. Both validators run for real here; only
 * the reads are faked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ruleset, RulesetFormData } from '@/types/ruleset';

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  AuthError: class AuthError extends Error {},
}));

vi.mock('@/lib/supabase/queries/rulesets', () => ({
  getRulesetById: vi.fn(),
  resolveEffectiveRuleset: vi.fn(),
  isCustomLeagueRuleset: vi.fn(() => false),
  listRulesetsByName: vi.fn(),
  createRuleset: vi.fn(),
  updateRuleset: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonById: vi.fn(),
  getParticipantCore: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/drafts', () => ({
  getDraftPoolBySeason: vi.fn(),
  getPicksByPlayer: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/format-rules', () => ({
  getFormatRules: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/evolutions', () => ({
  getPlayerTrackers: vi.fn(),
}));

vi.mock('@/lib/draft/epb-thresholds', () => ({
  getSeasonLineThresholds: vi.fn(),
}));

import { POST } from '../route';
import { requirePlayer } from '@/lib/auth/helpers';
import { resolveEffectiveRuleset } from '@/lib/supabase/queries/rulesets';
import { getParticipantCore, getSeasonById } from '@/lib/supabase/queries/seasons';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getDraftPoolBySeason } from '@/lib/supabase/queries/drafts';
import { getFormatRules } from '@/lib/supabase/queries/format-rules';
import { getPlayerTrackers } from '@/lib/supabase/queries/evolutions';
import { getSeasonLineThresholds } from '@/lib/draft/epb-thresholds';
import { pointBuyBattleRulesetInput } from '@/lib/season/point-buy-battle-ruleset';
import { formatPack } from '@/lib/format-pack';
import { makeRequest } from '@/lib/__tests__/helpers/api-request';

const RULESET_ID = '00000000-0000-4000-8000-000000000101';
const SEASON_ID = '00000000-0000-4000-8000-000000000102';
const TOURNAMENT_ID = '00000000-0000-4000-8000-000000000103';

const PLAYER = {
  playerId: '00000000-0000-4000-8000-000000000110',
  name: 'Test',
  isAdmin: false,
  isResourceAdmin: false,
  isCreator: false,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
};

/** The pack's banned move; the season below has lifted it. */
const LIFTED_MOVE = formatPack.epb.defaults.bannedMoves[0];

const TEAM = [
  {
    name: '',
    species: 'Basculegion',
    gender: 'M',
    item: 'Choice Band',
    ability: 'Swift Swim',
    evs: { hp: 4, atk: 252, def: 0, spa: 0, spd: 0, spe: 252 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    nature: 'Adamant',
    level: 100,
    moves: [LIFTED_MOVE, 'Wave Crash'],
  },
];

function asRow(input: RulesetFormData): Ruleset {
  return {
    id: RULESET_ID,
    name: input.name,
    base_format: input.base_format,
    is_doubles: input.is_doubles,
    clauses: input.clauses,
    bans: {
      pokemon: input.banned_pokemon,
      moves: input.banned_moves,
      items: input.banned_items,
      abilities: input.banned_abilities,
    },
    additions: { pokemon: input.added_pokemon },
    custom_rules_string: input.custom_rules_string,
    min_shared_type_pct: input.min_shared_type_pct,
    team_constraints: input.team_constraints,
    created_by: null,
    created_at: '',
    updated_at: '',
  };
}

function mockResolvedRow(row: Ruleset) {
  vi.mocked(resolveEffectiveRuleset).mockResolvedValue({
    ruleset: row,
    rulesetId: row.id,
    source: 'fallback',
    fellBack: true,
  });
}

async function validate() {
  const res = await POST(
    makeRequest({ pokemon: TEAM, ruleset_id: RULESET_ID, tournament_id: TOURNAMENT_ID }),
  );
  return (await res.json()) as { success: boolean; data: { valid: boolean; issues: { issue: string }[] } };
}

describe('POST /api/validate-team: point-buy battle ruleset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlayer).mockResolvedValue(PLAYER as never);
    vi.mocked(getTournamentById).mockResolvedValue({
      id: TOURNAMENT_ID,
      ruleset_id: RULESET_ID,
      season_id: SEASON_ID,
      bracket_type: 'round_robin',
    } as never);
    vi.mocked(getSeasonById).mockResolvedValue({
      id: SEASON_ID,
      name: 'Point-buy league',
      format_type: 'evolution_point_buy',
      ruleset_id: RULESET_ID,
    } as never);
    vi.mocked(getParticipantCore).mockResolvedValue(null);
    vi.mocked(getDraftPoolBySeason).mockResolvedValue(null);
    vi.mocked(getPlayerTrackers).mockResolvedValue([]);
    vi.mocked(getSeasonLineThresholds).mockResolvedValue([]);
    // The season's format_rules ban a different move: the pack's ban is lifted.
    vi.mocked(getFormatRules).mockResolvedValue({
      banned_moves: ['Shed Tail'],
      banned_items: [...formatPack.epb.defaults.bannedItems],
      tera_rules: null,
    } as never);
  });

  it('accepts a move the season lifted from its format_rules', async () => {
    mockResolvedRow(asRow(pointBuyBattleRulesetInput()));

    const body = await validate();

    expect(body.success).toBe(true);
    expect(body.data.issues.filter((i) => i.issue.includes(LIFTED_MOVE))).toEqual([]);
    expect(body.data.valid).toBe(true);
  });

  it('control: a row still carrying the pack ban would reject the team', async () => {
    const legacy = asRow({ ...pointBuyBattleRulesetInput(), banned_moves: [LIFTED_MOVE] });
    mockResolvedRow(legacy);

    const body = await validate();

    expect(body.data.valid).toBe(false);
    expect(body.data.issues.some((i) => i.issue.includes(LIFTED_MOVE))).toBe(true);
  });

  it('passes the season format type to the resolver', async () => {
    mockResolvedRow(asRow(pointBuyBattleRulesetInput()));

    await validate();

    expect(resolveEffectiveRuleset).toHaveBeenCalledWith(
      expect.objectContaining({
        season: expect.objectContaining({ formatType: 'evolution_point_buy', rulesetId: RULESET_ID }),
      }),
    );
  });
});
