import { describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));

import { buildWorld, evalUuid, resolvePlaceholders, resolveToken, type World } from '../world';

/**
 * The placeholders of the local-stack stages: ids and names that exist only while a run goes on (`dynamic`), and values the code
 * computes. The plan stage's tokens are covered in `world.test.ts`.
 */
const world = (): World => {
  const w = buildWorld('baseline', 'site_admin');
  w.dynamic = {
    proposalLast: '11111111-1111-4111-8111-111111111111',
    runTag: 'ab12',
    ledger: { league_create: '22222222-2222-4222-8222-222222222222' },
    computed: { 'preset_pokemon.gen9ou+kingambit': { mode: 'block', ids: ['kingambit'] } },
    seeded: {
      ready_league: { id: '33333333-3333-4333-8333-333333333333', name: 'LG6 Ready League ab121', phaseIds: ['44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555'] },
      started_league_ruleset: { id: '66666666-6666-4666-8666-666666666666', name: 'RS3 Started League ab121', rulesetDefinitionId: '77777777-7777-4777-8777-777777777777', rulesetVersionId: '88888888-8888-4888-8888-888888888888', rulesetName: 'RS3 Gen 9 OU ab121' },
    },
  };
  return w;
};

describe('dynamic placeholders', () => {
  it('resolve the newest proposal, the run tag, the ledger entity and the seeded entities', () => {
    const w = world();
    expect(resolvePlaceholders(w, 'undo {{proposal:last}}')).toBe('undo 11111111-1111-4111-8111-111111111111');
    expect(resolvePlaceholders(w, 'LG9 Cup {{run:tag}}')).toBe('LG9 Cup ab12');
    expect(resolvePlaceholders(w, { season_id: '{{ledger:league_create}}' })).toEqual({ season_id: '22222222-2222-4222-8222-222222222222' });
    expect(resolvePlaceholders(w, ['{{seed:ready_league}}', '{{seedname:ready_league}}', '{{seed:ready_league.phase1}}', '{{seed:ready_league.phase2}}'])).toEqual([
      '33333333-3333-4333-8333-333333333333',
      'LG6 Ready League ab121',
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
    ]);
    expect(resolvePlaceholders(w, ['{{seed:started_league_ruleset.definition}}', '{{seed:started_league_ruleset.version}}', '{{seedname:started_league_ruleset.ruleset}}'])).toEqual([
      '77777777-7777-4777-8777-777777777777',
      '88888888-8888-4888-8888-888888888888',
      'RS3 Gen 9 OU ab121',
    ]);
  });

  it('resolve the phases of the baseline league like the ids the loader writes', () => {
    const w = world();
    expect(resolveToken(w, 'phase', 'L1-1')).toBe(evalUuid('phase', 'L1-1'));
    expect(resolveToken(w, 'phase', 'L1-2')).toBe(evalUuid('phase', 'L1-2'));
    expect(() => resolveToken(w, 'phase', 'L1-3')).toThrow(/unknown placeholder/);
  });

  it('refuse a token nothing filled in, instead of sending the literal text', () => {
    const plan = buildWorld('baseline', 'site_admin');
    for (const text of ['{{proposal:last}}', '{{run:tag}}', '{{ledger:league_create}}', '{{seed:ready_league}}', '{{seedname:ready_league}}']) {
      expect(() => resolvePlaceholders(plan, text), text).toThrow(/unknown placeholder/);
    }
    const w = world();
    expect(() => resolvePlaceholders(w, '{{seed:ready_league.phase9}}')).toThrow(/unknown placeholder/);
    expect(() => resolvePlaceholders(w, '{{ledger:phase_create}}')).toThrow(/unknown placeholder/);
  });
});

describe('computed values', () => {
  it('replace a whole string by the JSON value the code computed, and only a whole string', () => {
    const w = world();
    expect(resolvePlaceholders(w, { 'resolved.pokemon': '{{computed:preset_pokemon.gen9ou+kingambit}}' })).toEqual({ 'resolved.pokemon': { mode: 'block', ids: ['kingambit'] } });
    // Inside a longer string the token is not a value; it is text the plain resolver does not know.
    expect(resolvePlaceholders(w, 'x {{computed:preset_pokemon.gen9ou+kingambit}}')).toBe('x {{computed:preset_pokemon.gen9ou+kingambit}}');
    expect(() => resolvePlaceholders(w, '{{computed:other}}')).toThrow(/unknown placeholder/);
  });
});
