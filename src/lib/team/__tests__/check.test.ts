/**
 * The shared server-side team check (`checkTeam`): which rules run, which roster applies, and what it reports when it
 * had to fall back. The synchronous core and the learnset layer have their own suites (`src/lib/pkmn/__tests__`); the
 * learnset layer is faked here, the rest runs for real over faked database reads.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonById: vi.fn(),
  getParticipantCore: vi.fn(),
}));

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
vi.mock('@/lib/pkmn/team-legality', () => ({ checkTeamLegality: vi.fn(async () => []) }));

import { checkTeam, rulesetForFormat } from '../check.server';
import { checkTeamLegality } from '@/lib/pkmn/team-legality';
import { getParticipantCore, getSeasonById } from '@/lib/supabase/queries/seasons';
import { getDraftPoolBySeason, getDraftPoolBySeasonGroup, getPicksByPlayer, GroupedLeaguePoolLookupError } from '@/lib/supabase/queries/drafts';
import { getSeasonGroupOfPlayer } from '@/lib/supabase/queries/season-groups';
import { getPlayerTrackers } from '@/lib/supabase/queries/evolutions';
import { getFormatRules } from '@/lib/supabase/queries/format-rules';
import { getSeasonLineThresholds } from '@/lib/draft/epb-thresholds';
import { makeRuleset } from '@/test/ruleset-fixtures';
import { makeSet } from '@/test/team-fixtures';
import type { Season } from '@/types/season';
import type { TeamValidationResult } from '@/types/team';

const PLAYER = '00000000-0000-4000-8000-000000000010';
const SEASON_ID = '00000000-0000-4000-8000-000000000002';
const OU = makeRuleset({ base_format: 'gen9ou', clauses: ['Species Clause'] });

const season = (format_type: string) => ({ id: SEASON_ID, format_type }) as unknown as Season;

const codesOf = (result: TeamValidationResult): string[] => [
  ...result.issues.map((i) => i.code ?? ''),
  ...(result.team_issue_details ?? []).map((i) => i.code ?? ''),
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(checkTeamLegality).mockResolvedValue([]);
  vi.mocked(getSeasonById).mockResolvedValue(null);
  vi.mocked(getParticipantCore).mockResolvedValue(null);
  vi.mocked(getDraftPoolBySeason).mockResolvedValue(null);
  vi.mocked(getPlayerTrackers).mockResolvedValue([]);
  vi.mocked(getSeasonLineThresholds).mockResolvedValue([]);
  vi.mocked(getFormatRules).mockResolvedValue(null);
});

describe('checkTeam: which rules ran', () => {
  it('enforces a stored ruleset and says so', async () => {
    const result = await checkTeam({ pokemon: [makeSet('Garchomp')], ruleset: OU });
    expect(result.valid).toBe(true);
    expect(result.ruleset_source).toEqual({ kind: 'ruleset' });
  });

  it('applies the FORMAT tier bans when there is no league ruleset (the agent used to skip them)', async () => {
    const result = await checkTeam({
      pokemon: [makeSet('Koraidon', { item: 'Choice Band', ability: 'Orichalcum Pulse', moves: ['Collision Course'] })],
      ruleset: null,
      format: 'gen9ou',
    });
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'species_banned', species: 'Koraidon' }));
    expect(result.ruleset_source).toEqual({ kind: 'format_preset', format: 'gen9ou' });
  });

  it('reads the format case-insensitively', () => {
    expect(rulesetForFormat('Gen9OU').source).toEqual({ kind: 'format_preset', format: 'gen9ou' });
  });

  it('reports a format the catalog does not know as basic: only the generation and the Species Clause', async () => {
    const { ruleset, source } = rulesetForFormat('gen8somethingcustom');
    expect(source).toEqual({ kind: 'format_basic', format: 'gen8somethingcustom' });
    expect(ruleset.gen).toBe(8);
    expect(ruleset.rules.clauses).toEqual(['speciesclause']);
    const result = await checkTeam({ pokemon: [makeSet('Garchomp')], ruleset: null, format: 'gen8somethingcustom' });
    expect(result.ruleset_source?.kind).toBe('format_basic');
  });

  it.each(['ruleset_not_found', 'ruleset_load_failed'] as const)(
    'never calls a team legal after %s: it checks the format, reports the fallback and is invalid',
    async (failure) => {
      const result = await checkTeam({ pokemon: [makeSet('Garchomp')], ruleset: null, rulesetFailure: failure, format: 'gen9ou' });
      expect(result.valid).toBe(false);
      expect(result.ruleset_source).toEqual({ kind: 'format_preset', format: 'gen9ou', fallback: failure });
      expect(result.team_issue_details).toContainEqual(
        expect.objectContaining({ code: 'ruleset_load_failed', params: { reason: failure } }),
      );
      expect(result.team_issues).toHaveLength(result.team_issue_details?.length ?? -1);
    },
  );

  it('refuses a rulesetFailure together with a ruleset: the flag would be silently ignored', async () => {
    await expect(checkTeam({ pokemon: [makeSet('Garchomp')], ruleset: OU, rulesetFailure: 'ruleset_load_failed' })).rejects.toThrow(
      /rulesetFailure is only meaningful/,
    );
  });

  it('needs a ruleset or a format', async () => {
    await expect(checkTeam({ pokemon: [makeSet()], ruleset: null })).rejects.toThrow(/ruleset or a format/);
  });
});

describe('checkTeam: the layers are unioned', () => {
  it('adds the learnset layer to the core, deduping repeated issues, and any error makes the team invalid', async () => {
    const illegal = { pokemon_index: 0, species: 'Garchomp', issue: 'Garchomp cannot legally learn Spore', severity: 'error' as const, code: 'move_illegal' as const };
    vi.mocked(checkTeamLegality).mockResolvedValue([illegal, illegal]);
    const result = await checkTeam({ pokemon: [makeSet('Garchomp')], ruleset: OU });
    expect(result.valid).toBe(false);
    expect(result.issues.filter((i) => i.code === 'move_illegal')).toHaveLength(1);
  });

  it('runs the real core: a duplicate move and an Item Clause alias reach the answer', async () => {
    const ruleset = makeRuleset({ base_format: 'gen9ou', clauses: ['Species Clause', 'Item Clause'] });
    const result = await checkTeam({
      pokemon: [
        makeSet('Garchomp', { item: 'Choice Scarf', moves: ['Earthquake', 'Earthquake'] }),
        makeSet('Dragonite', { item: 'choicescarf', ability: 'Multiscale' }),
      ],
      ruleset,
    });
    expect(codesOf(result)).toEqual(expect.arrayContaining(['duplicate_move', 'item_clause']));
  });
});

describe('checkTeam: the drafted roster of a legacy draft league', () => {
  const team = [makeSet('Garchomp'), makeSet('Dragonite', { ability: 'Multiscale' })];

  it('reads the live picks of the player in their initial pool', async () => {
    vi.mocked(getDraftPoolBySeason).mockResolvedValue({ id: 'pool-1' } as never);
    vi.mocked(getPicksByPlayer).mockResolvedValue([{ pokemon_name: 'Garchomp' } as never]);

    const result = await checkTeam({ pokemon: team, ruleset: OU, playerId: PLAYER, seasonId: SEASON_ID });

    expect(getPicksByPlayer).toHaveBeenCalledWith('pool-1', PLAYER);
    expect(result.team_issue_details).toEqual([
      expect.objectContaining({ code: 'not_in_roster', params: { species: 'Dragonite' } }),
    ]);
    expect(result.valid).toBe(false);
  });

  it('matches the roster by dex id, not by the raw lower-cased name', async () => {
    vi.mocked(getDraftPoolBySeason).mockResolvedValue({ id: 'pool-1' } as never);
    vi.mocked(getPicksByPlayer).mockResolvedValue([{ pokemon_name: 'GARCHOMP' } as never, { pokemon_name: 'dragonite' } as never]);
    const result = await checkTeam({ pokemon: team, ruleset: OU, playerId: PLAYER, seasonId: SEASON_ID });
    expect(codesOf(result)).not.toContain('not_in_roster');
  });

  it('a pool with no live picks is an EMPTY roster: the strictest rule, every member is "not in your draft roster"', async () => {
    vi.mocked(getDraftPoolBySeason).mockResolvedValue({ id: 'pool-1' } as never);
    vi.mocked(getPicksByPlayer).mockResolvedValue([]);
    const result = await checkTeam({ pokemon: team, ruleset: OU, playerId: PLAYER, seasonId: SEASON_ID });
    expect(result.team_issue_details?.filter((i) => i.code === 'not_in_roster')).toHaveLength(2);
    expect(result.valid).toBe(false);
  });

  it('has no roster rule for a player with no pool (no draft context at all)', async () => {
    const result = await checkTeam({ pokemon: team, ruleset: OU, playerId: PLAYER, seasonId: SEASON_ID });
    expect(getPicksByPlayer).not.toHaveBeenCalled();
    expect(codesOf(result)).not.toContain('not_in_roster');
  });

  it('has no roster rule without a season or without a player', async () => {
    await checkTeam({ pokemon: team, ruleset: OU, playerId: PLAYER });
    await checkTeam({ pokemon: team, ruleset: OU, seasonId: SEASON_ID });
    expect(getDraftPoolBySeason).not.toHaveBeenCalled();
  });

  it('reads the pool of the caller’s own group in a league with groups', async () => {
    vi.mocked(getDraftPoolBySeason).mockRejectedValueOnce(new GroupedLeaguePoolLookupError(SEASON_ID));
    vi.mocked(getSeasonGroupOfPlayer).mockResolvedValueOnce({ id: 'group-b' } as never);
    vi.mocked(getDraftPoolBySeasonGroup).mockResolvedValueOnce({ id: 'pool-b' } as never);
    vi.mocked(getPicksByPlayer).mockResolvedValue([{ pokemon_name: 'Garchomp' } as never, { pokemon_name: 'Dragonite' } as never]);

    const result = await checkTeam({ pokemon: team, ruleset: OU, playerId: PLAYER, seasonId: SEASON_ID });

    expect(getDraftPoolBySeasonGroup).toHaveBeenCalledWith(SEASON_ID, 'group-b', 'initial');
    expect(getPicksByPlayer).toHaveBeenCalledWith('pool-b', PLAYER);
    expect(result.valid).toBe(true);
  });
});

describe('checkTeam: the drafted roster of an Evolution Point Buy league', () => {
  const OSHAWOTT = { line_id: 'oshawott-samurott', base_pokemon: 'Oshawott', stage2_pokemon: 'Dewott', stage3_pokemon: 'Samurott', stage2_kos: 3, stage3_kos: 8 };
  const OSHAWOTT_HISUI = { line_id: 'oshawott-samurott-hisui', base_pokemon: 'Oshawott', stage2_pokemon: 'Dewott-Hisui', stage3_pokemon: 'Samurott-Hisui', stage2_kos: 3, stage3_kos: 8 };
  const GIBLE = { line_id: 'gible-garchomp', base_pokemon: 'Gible', stage2_pokemon: 'Gabite', stage3_pokemon: 'Garchomp', stage2_kos: 3, stage3_kos: 8 };
  const tracker = (line_id: string, base_pokemon: string, locked_stage3_pokemon: string | null = null) =>
    ({ line_id, base_pokemon, locked_stage3_pokemon, total_kos: 0 }) as never;

  const samurott = makeSet('Samurott', { ability: 'Torrent', moves: ['Surf'], item: 'Mystic Water' });
  const samurottHisui = makeSet('Samurott-Hisui', { ability: 'Sharpness', moves: ['Ceaseless Edge'], item: 'Choice Band' });
  const garchomp = makeSet('Garchomp');

  beforeEach(() => {
    vi.mocked(getSeasonById).mockResolvedValue(season('evolution_point_buy'));
    vi.mocked(getSeasonLineThresholds).mockResolvedValue([OSHAWOTT, OSHAWOTT_HISUI, GIBLE] as never);
  });

  const run = (pokemon = [samurott]) => checkTeam({ pokemon, ruleset: OU, playerId: PLAYER, seasonId: SEASON_ID });

  it('an Oshawott line owns its evolved form: Samurott is not a "not in roster" error (the pick stores the base)', async () => {
    vi.mocked(getPlayerTrackers).mockResolvedValue([tracker('oshawott-samurott', 'Oshawott')]);
    const result = await run();
    expect(codesOf(result)).not.toContain('not_in_roster');
    expect(result.valid).toBe(true);
    // The trackers are the roster: the pick list is never read.
    expect(getPicksByPlayer).not.toHaveBeenCalled();
  });

  it('owns every stage of the line, and only the branch the line has', async () => {
    vi.mocked(getPlayerTrackers).mockResolvedValue([tracker('oshawott-samurott', 'Oshawott')]);
    const result = await run([samurottHisui]);
    expect(result.team_issue_details).toEqual([
      expect.objectContaining({ code: 'not_in_roster', params: { species: 'Samurott-Hisui' } }),
    ]);
  });

  it('owns the Hisuian branch when that is the line the trainer holds', async () => {
    vi.mocked(getPlayerTrackers).mockResolvedValue([tracker('oshawott-samurott-hisui', 'Oshawott')]);
    const result = await run([samurottHisui]);
    expect(codesOf(result)).not.toContain('not_in_roster');
  });

  it('owns a locked stage-3 branch even when the line is not among the season’s lines', async () => {
    vi.mocked(getSeasonLineThresholds).mockResolvedValue([]);
    vi.mocked(getPlayerTrackers).mockResolvedValue([tracker('unknown-line', 'Oshawott', 'Samurott-Hisui')]);
    const result = await run([samurottHisui]);
    expect(codesOf(result)).not.toContain('not_in_roster');
  });

  it('a Redraft is in the trackers: a dropped line is not owned any more, a gained line is', async () => {
    // Before the Redraft the trainer held Oshawott and Gible; they dropped Oshawott and took nothing back.
    vi.mocked(getPlayerTrackers).mockResolvedValue([tracker('gible-garchomp', 'Gible')]);
    const result = await run([samurott, garchomp]);
    expect(result.team_issue_details).toEqual([
      expect.objectContaining({ code: 'not_in_roster', params: { species: 'Samurott' } }),
    ]);

    // A redraft pick of the Oshawott line creates its tracker: now Samurott is owned.
    vi.mocked(getPlayerTrackers).mockResolvedValue([tracker('gible-garchomp', 'Gible'), tracker('oshawott-samurott', 'Oshawott')]);
    expect(codesOf(await run([samurott, garchomp]))).not.toContain('not_in_roster');
  });

  it('a trainer with live picks but no trackers yet owns the lines of the picked bases', async () => {
    vi.mocked(getDraftPoolBySeason).mockResolvedValue({ id: 'pool-1' } as never);
    vi.mocked(getPicksByPlayer).mockResolvedValue([{ pokemon_name: 'Gible' } as never]);
    const result = await run([garchomp, samurott]);
    expect(result.team_issue_details).toEqual([
      expect.objectContaining({ code: 'not_in_roster', params: { species: 'Samurott' } }),
    ]);
  });

  it('picks of a shared base own the forms of every line that base starts (Samurott and Samurott-Hisui)', async () => {
    vi.mocked(getDraftPoolBySeason).mockResolvedValue({ id: 'pool-1' } as never);
    vi.mocked(getPicksByPlayer).mockResolvedValue([{ pokemon_name: 'Oshawott' } as never]);
    const result = await run([samurott]);
    expect(codesOf(result)).not.toContain('not_in_roster');
    expect(codesOf(await run([samurottHisui]))).not.toContain('not_in_roster');
    expect(codesOf(await run([garchomp]))).toContain('not_in_roster'); // a base that was not picked owns nothing
  });

  it('a trainer with no trackers and no pool has no roster rule', async () => {
    const result = await run([samurott]);
    expect(codesOf(result)).not.toContain('not_in_roster');
  });

  it('applies the season’s format rules and merges them with the core, deduped', async () => {
    vi.mocked(getPlayerTrackers).mockResolvedValue([tracker('gible-garchomp', 'Gible')]);
    vi.mocked(getFormatRules).mockResolvedValue({ banned_moves: ['Earthquake'], banned_items: ['Leftovers'], tera_rules: null } as never);
    const result = await run([garchomp]);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => /Earthquake/.test(i.issue))).toBe(true);
    expect(result.team_issues).toEqual([...new Set(result.team_issues)]);
  });
});

describe('checkTeam: the assigned core', () => {
  const coreRuleset = makeRuleset({ base_format: 'gen9ou', team_constraints: { tera_match: 'player_core' } });
  const teraGarchomp = [makeSet('Garchomp', { tera_type: 'Dragon' })];

  it('reads the core server-side from the season', async () => {
    vi.mocked(getParticipantCore).mockResolvedValue(['Fire', 'Water', 'Grass'] as never);
    const result = await checkTeam({ pokemon: teraGarchomp, ruleset: coreRuleset, playerId: PLAYER, seasonId: SEASON_ID });
    expect(getParticipantCore).toHaveBeenCalledWith(SEASON_ID, PLAYER);
    expect(codesOf(result)).toContain('tera_core_mismatch');
  });

  it('uses a core the server already knows without reading it again', async () => {
    const result = await checkTeam({
      pokemon: teraGarchomp,
      ruleset: coreRuleset,
      playerId: PLAYER,
      seasonId: SEASON_ID,
      playerCore: ['Dragon', 'Water', 'Grass'] as never,
    });
    expect(getParticipantCore).not.toHaveBeenCalled();
    expect(codesOf(result)).not.toContain('tera_core_mismatch');
  });

  it('a failed core read is its own cause: logged, labelled core_load_failed, never "no core assigned", and never valid', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getParticipantCore).mockRejectedValue(new Error('db down'));
    const result = await checkTeam({ pokemon: teraGarchomp, ruleset: coreRuleset, playerId: PLAYER, seasonId: SEASON_ID });
    expect(log).toHaveBeenCalled();
    expect(codesOf(result)).toContain('core_load_failed');
    expect(codesOf(result)).not.toContain('tera_match_no_core');
    expect(result.valid).toBe(false);
    expect(result.team_issues).toHaveLength(result.team_issue_details?.length ?? -1);
    log.mockRestore();
  });

  it('a failed core read is never valid even when no set has a tera type (a tera-only core rule)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getParticipantCore).mockRejectedValue(new Error('db down'));
    const result = await checkTeam({ pokemon: [makeSet('Garchomp')], ruleset: coreRuleset, playerId: PLAYER, seasonId: SEASON_ID });
    expect(codesOf(result)).toContain('core_load_failed');
    expect(result.valid).toBe(false);
    log.mockRestore();
  });

  it('a core that is genuinely not assigned still says so (the read worked)', async () => {
    vi.mocked(getParticipantCore).mockResolvedValue(null);
    const result = await checkTeam({ pokemon: teraGarchomp, ruleset: coreRuleset, playerId: PLAYER, seasonId: SEASON_ID });
    expect(codesOf(result)).toContain('tera_match_no_core');
    expect(codesOf(result)).not.toContain('core_load_failed');
  });

  it('a failed core read adds nothing when the ruleset does not use the core', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getParticipantCore).mockRejectedValue(new Error('db down'));
    const result = await checkTeam({ pokemon: [makeSet('Garchomp')], ruleset: OU, playerId: PLAYER, seasonId: SEASON_ID });
    expect(codesOf(result)).not.toContain('core_load_failed');
    expect(result.valid).toBe(true);
    log.mockRestore();
  });
});
