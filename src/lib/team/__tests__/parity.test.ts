/**
 * "The agent says legal" == "the editor says legal": the teambuilder's live check (`POST /api/validate-team`), the import
 * preview (`POST /api/import-team`), the AI agent's `validateTeam` tool and `checkTeam` itself are run over ONE fixture
 * team and one ruleset, and must agree on every issue. Real dex, real validators; only the reads are faked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  AuthError: class AuthError extends Error {},
}));
vi.mock('@/lib/ruleset-studio/exposure', () => ({ readExposedRuleset: vi.fn() }));
vi.mock('@/lib/supabase/queries/rulesets', () => ({ getRulesetById: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: vi.fn() }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: vi.fn(), getParticipantCore: vi.fn() }));
vi.mock('@/lib/pkmn/teams', () => ({ parseTeamText: vi.fn() }));
vi.mock('@/lib/utils/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/rate-limit')>()),
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 19, retryAfterSeconds: 0 })),
}));

import { POST as validateRoute } from '@/app/api/validate-team/route';
import { POST as importRoute } from '@/app/api/import-team/route';
import { validateTeam as agentValidate } from '@/lib/ai/agent/tools/validate';
import { checkTeam } from '../check.server';
import { requirePlayer } from '@/lib/auth/helpers';
import { readExposedRuleset } from '@/lib/ruleset-studio/exposure';
import { parseTeamText } from '@/lib/pkmn/teams';
import { makeRuleset } from '@/test/ruleset-fixtures';
import { makeSet } from '@/test/team-fixtures';
import type { PokemonSet } from '@/types/team';

const RULESET_ID = '00000000-0000-4000-8000-000000000001';
const RULESET = makeRuleset({
  id: RULESET_ID,
  base_format: 'gen9ou',
  clauses: ['Species Clause', 'Item Clause'],
  bans: { pokemon: ['Dragonite'], moves: ['Stealth Rock'], items: [], abilities: [] },
});

/** One team with a problem of every kind the shared check owns. */
const TEAM: PokemonSet[] = [
  makeSet('Garchomp', { ability: 'Levitate', moves: ['Earthquake', 'Earthquake', 'Spore'], item: 'Choice Scarf' }), // ability, duplicate, learnset
  makeSet('Dragonite', { ability: 'Multiscale', item: 'choicescarf', moves: ['Extreme Speed', 'Stealth Rock'] }), // banned species and move, Item Clause by id
  makeSet('Gengar', { ability: 'Cursed Body', item: 'Life Orb', moves: ['Shadow Ball'], evs: { hp: 252, atk: 0, def: 0, spa: 252, spd: 252, spe: 252 } }), // EV total above 510
  makeSet('Great Tusk', { ability: 'Protosynthesis', item: 'Booster Energy', moves: ['Headlong Rush', 'Rapid Spin'] }), // legal
];

const requestOf = (body: unknown) => ({ json: vi.fn().mockResolvedValue(body) }) as unknown as NextRequest;

/** The comparable part of an issue: what the agent tool exposes of it. */
const flat = (issues: { pokemon_index: number; species: string; issue: string; severity: string }[]) =>
  issues
    .map((i) => ({ pokemon_index: i.pokemon_index, species: i.species, issue: i.issue, severity: i.severity }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requirePlayer).mockResolvedValue({ playerId: '00000000-0000-4000-8000-000000000010', isAdmin: false } as never);
  vi.mocked(readExposedRuleset).mockResolvedValue(RULESET);
  vi.mocked(parseTeamText).mockReturnValue(TEAM);
});

describe('one team, four entry points, one answer', () => {
  it('the live check, the import preview, the agent tool and checkTeam list the same issues', async () => {
    const direct = await checkTeam({ pokemon: TEAM, ruleset: RULESET });

    const live = await (await validateRoute(requestOf({ pokemon: TEAM, ruleset_id: RULESET_ID }))).json();
    const previewRes = await importRoute(requestOf({ text: 'x', ruleset_id: RULESET_ID }));
    const preview = await previewRes.json();
    expect(preview).toMatchObject({ success: true });
    const agent = await agentValidate({
      format: 'gen9ou',
      ruleset_id: RULESET_ID,
      team: TEAM.map((s) => ({
        species: s.species, item: s.item, ability: s.ability, nature: s.nature, level: s.level, moves: s.moves, evs: s.evs, ivs: s.ivs,
      })),
    });

    expect(direct.valid).toBe(false);
    expect(live.data.valid).toBe(direct.valid);
    expect(preview.data.validation.valid).toBe(direct.valid);
    expect(agent.valid).toBe(direct.valid);

    const expected = flat(direct.issues);
    expect(flat(live.data.issues)).toEqual(expected);
    expect(flat(preview.data.validation.issues)).toEqual(expected);
    expect(flat(agent.issues)).toEqual(expected);

    expect(live.data.team_issues).toEqual(direct.team_issues);
    expect(preview.data.validation.team_issues).toEqual(direct.team_issues);
    expect(agent.team_issues).toEqual(direct.team_issues);
  });

  it('that fixture exercises every rule the shared check owns', async () => {
    const direct = await checkTeam({ pokemon: TEAM, ruleset: RULESET });
    const codes = new Set([...direct.issues.map((i) => i.code), ...(direct.team_issue_details ?? []).map((i) => i.code)]);
    for (const code of ['move_illegal', 'ability_illegal', 'duplicate_move', 'item_clause', 'ev_total', 'species_banned', 'move_banned']) {
      expect(codes, code).toContain(code);
    }
  });

  it('a legal team is legal everywhere', async () => {
    const legal = [makeSet('Great Tusk', { ability: 'Protosynthesis', item: 'Booster Energy', moves: ['Headlong Rush', 'Rapid Spin'] }), makeSet('Garchomp', { moves: ['Earthquake', 'Dragon Claw', 'Swords Dance', 'Scale Shot'] })];
    vi.mocked(parseTeamText).mockReturnValue(legal);
    const direct = await checkTeam({ pokemon: legal, ruleset: RULESET });
    const live = await (await validateRoute(requestOf({ pokemon: legal, ruleset_id: RULESET_ID }))).json();
    const agent = await agentValidate({ format: 'gen9ou', ruleset_id: RULESET_ID, team: legal.map((s) => ({ species: s.species, item: s.item, ability: s.ability, moves: s.moves, evs: s.evs })) });
    expect(direct.issues).toEqual([]);
    expect(direct.team_issues).toEqual([]);
    expect([direct.valid, live.data.valid, agent.valid]).toEqual([true, true, true]);
  });
});
