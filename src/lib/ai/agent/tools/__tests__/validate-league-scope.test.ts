/**
 * The agent's `validateTeam` in a league: with the server-set `player_id` / `season_id` it reads and applies the
 * drafted roster, the assigned core and the Evolution Point Buy state of THAT player and league, and nothing the model
 * puts in the call can redirect those reads. Real `checkTeam` and validators; only the database reads are faked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ruleset-studio/exposure', () => ({ readExposedRuleset: vi.fn() }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: vi.fn(), getParticipantCore: vi.fn() }));
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

import { validateTeam } from '../validate';
import { AGENT_TOOLS } from '../registry';
import { executeTool } from '../execute';
import { applyToolOverrides } from '../../orchestrator';
import { readExposedRuleset } from '@/lib/ruleset-studio/exposure';
import { getParticipantCore, getSeasonById } from '@/lib/supabase/queries/seasons';
import { getDraftPoolBySeason, getPicksByPlayer } from '@/lib/supabase/queries/drafts';
import { getPlayerTrackers } from '@/lib/supabase/queries/evolutions';
import { getFormatRules } from '@/lib/supabase/queries/format-rules';
import { getSeasonLineThresholds } from '@/lib/draft/epb-thresholds';
import { makeRuleset } from '@/test/ruleset-fixtures';
import type { Season } from '@/types/season';

const ME = '00000000-0000-4000-8000-000000000011';
const OTHER = '00000000-0000-4000-8000-000000000099';
const SEASON = '00000000-0000-4000-8000-000000000002';
const OTHER_SEASON = '00000000-0000-4000-8000-000000000098';

const garchomp = { species: 'Garchomp', item: 'Leftovers', ability: 'Rough Skin', moves: ['Earthquake'] };
const dragonite = { species: 'Dragonite', item: 'Heavy-Duty Boots', ability: 'Multiscale', moves: ['Extreme Speed'] };

const OU = makeRuleset({ id: 'rs-1', base_format: 'gen9ou', clauses: ['Species Clause'] });
const TERA_CORE = makeRuleset({ id: 'rs-core', base_format: 'gen9ou', clauses: ['Species Clause'], team_constraints: { tera_match: 'player_core' } });

const season = (format_type: string) => ({ id: SEASON, format_type }) as unknown as Season;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readExposedRuleset).mockResolvedValue(OU);
  vi.mocked(getSeasonById).mockResolvedValue(season('draft'));
  vi.mocked(getParticipantCore).mockResolvedValue(null);
  vi.mocked(getDraftPoolBySeason).mockResolvedValue({ id: 'pool-1' } as never);
  vi.mocked(getPicksByPlayer).mockResolvedValue([]);
  vi.mocked(getPlayerTrackers).mockResolvedValue([]);
  vi.mocked(getSeasonLineThresholds).mockResolvedValue([]);
  vi.mocked(getFormatRules).mockResolvedValue(null);
});

describe('validateTeam in a league (server-set player_id and season_id)', () => {
  it('reads and applies the drafted roster of that player', async () => {
    vi.mocked(getPicksByPlayer).mockResolvedValue([{ pokemon_name: 'Garchomp' } as never]);

    const result = await validateTeam({ format: 'gen9ou', ruleset_id: 'rs-1', player_id: ME, season_id: SEASON, team: [garchomp, dragonite] });

    expect(getDraftPoolBySeason).toHaveBeenCalledWith(SEASON);
    expect(getPicksByPlayer).toHaveBeenCalledWith('pool-1', ME);
    expect(result.valid).toBe(false);
    expect(result.team_issues).toEqual(['Dragonite is not in your draft roster']);
  });

  it('reads the assigned core of that player from the season and applies it', async () => {
    vi.mocked(readExposedRuleset).mockResolvedValue(TERA_CORE);
    vi.mocked(getDraftPoolBySeason).mockResolvedValue(null);
    vi.mocked(getParticipantCore).mockResolvedValue(['Fire', 'Water', 'Grass'] as never);

    const result = await validateTeam({ format: 'gen9ou', ruleset_id: 'rs-core', player_id: ME, season_id: SEASON, team: [{ ...garchomp, teraType: 'Dragon' }] });

    expect(getParticipantCore).toHaveBeenCalledWith(SEASON, ME);
    expect(result.issues.some((i) => /Tera type Dragon must match one of your core types/.test(i.issue))).toBe(true);
  });

  it('applies the Evolution Point Buy state: the trainer’s trackers are the roster and the season’s rules bind', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(season('evolution_point_buy'));
    vi.mocked(getSeasonLineThresholds).mockResolvedValue([
      { line_id: 'gible-garchomp', base_pokemon: 'Gible', stage2_pokemon: 'Gabite', stage3_pokemon: 'Garchomp', stage2_kos: 3, stage3_kos: 11 },
    ] as never);
    vi.mocked(getPlayerTrackers).mockResolvedValue([{ line_id: 'gible-garchomp', base_pokemon: 'Gible', locked_stage3_pokemon: null, total_kos: 0 }] as never);
    vi.mocked(getFormatRules).mockResolvedValue({ banned_moves: ['Earthquake'], banned_items: [], tera_rules: null } as never);

    const result = await validateTeam({ format: 'gen9ou', ruleset_id: 'rs-1', player_id: ME, season_id: SEASON, team: [garchomp] });

    expect(getPlayerTrackers).toHaveBeenCalledWith(SEASON, ME);
    expect(result.team_issues).not.toContain('Garchomp is not in your draft roster'); // owned through the Gible line
    expect(result.issues.some((i) => /Earthquake/.test(i.issue))).toBe(true); // the season's EPB ban
    expect(result.valid).toBe(false);
  });

  it('without a league (no season_id) none of the league reads happen', async () => {
    const result = await validateTeam({ format: 'gen9ou', ruleset_id: 'rs-1', player_id: ME, team: [garchomp, dragonite] });

    expect(result.valid).toBe(true);
    expect(getSeasonById).not.toHaveBeenCalled();
    expect(getDraftPoolBySeason).not.toHaveBeenCalled();
    expect(getParticipantCore).not.toHaveBeenCalled();
  });

  it('refuses season_id without player_id instead of silently dropping the league', async () => {
    await expect(validateTeam({ format: 'gen9ou', season_id: SEASON, team: [garchomp] })).rejects.toThrow(/player_id is required/);
  });
});

describe('the model cannot redirect those reads', () => {
  const overrides = { userId: ME, rulesetId: 'rs-core', playerCore: null, seasonId: SEASON };

  /** The whole path of one call: the model's input, its schema, the server's overrides, the dispatcher. */
  async function call(modelInput: Record<string, unknown>, serverOverrides: Parameters<typeof applyToolOverrides>[2] = overrides) {
    const seen = AGENT_TOOLS.validateTeam.modelInputSchema?.parse(modelInput);
    return executeTool('validateTeam', applyToolOverrides('validateTeam', seen, serverOverrides));
  }

  it('a player_id, season_id and player_core the model invents are replaced by the server’s', async () => {
    vi.mocked(readExposedRuleset).mockResolvedValue(TERA_CORE);
    vi.mocked(getDraftPoolBySeason).mockResolvedValue(null);
    vi.mocked(getParticipantCore).mockImplementation(async (_season, player) => (player === ME ? (['Fire', 'Water', 'Grass'] as never) : (['Dragon', 'Dragon', 'Dragon'] as never)));

    const res = await call({
      format: 'gen9ou',
      team: [{ ...garchomp, teraType: 'Dragon' }],
      player_id: OTHER,
      season_id: OTHER_SEASON,
      player_core: ['Dragon', 'Ground', 'Poison'], // would make Dragon legal
    });

    expect(res.ok).toBe(true);
    // Only the authenticated player and the resolved league were read.
    expect(getParticipantCore).toHaveBeenCalledTimes(1);
    expect(getParticipantCore).toHaveBeenCalledWith(SEASON, ME);
    expect(getSeasonById).toHaveBeenCalledWith(SEASON);
    expect(getSeasonById).not.toHaveBeenCalledWith(OTHER_SEASON);
    // …and the server's core decided: Dragon is not one of Fire/Water/Grass.
    expect(res.ok && (res.data as { issues: { issue: string }[] }).issues.some((i) => /core types/.test(i.issue))).toBe(true);
  });

  it('the roster read is for the authenticated player, never the one the model names', async () => {
    vi.mocked(getPicksByPlayer).mockResolvedValue([{ pokemon_name: 'Garchomp' } as never]);
    vi.mocked(readExposedRuleset).mockResolvedValue(OU);

    const res = await call({ format: 'gen9ou', team: [garchomp], player_id: OTHER }, { ...overrides, rulesetId: 'rs-1' });

    expect(res.ok).toBe(true);
    expect(getPicksByPlayer).toHaveBeenCalledWith('pool-1', ME);
    expect(getPicksByPlayer).not.toHaveBeenCalledWith(expect.anything(), OTHER);
  });

  it('with no league resolved, a season_id the model names is dropped: no roster, core or EPB read', async () => {
    const res = await call({ format: 'gen9ou', team: [garchomp], season_id: OTHER_SEASON }, { userId: ME, rulesetId: null, playerCore: null, seasonId: null });

    expect(res.ok).toBe(true);
    expect(getSeasonById).not.toHaveBeenCalled();
    expect(getDraftPoolBySeason).not.toHaveBeenCalled();
    expect(getPlayerTrackers).not.toHaveBeenCalled();
  });
});
