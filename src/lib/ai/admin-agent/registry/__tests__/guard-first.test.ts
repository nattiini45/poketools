import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * "Always guarded" (plan 3.6.2, 6.1): EVERY runnable tool runs its route's live guard before it reads anything. With the
 * guards refusing and the database client replaced by one that throws on first touch, each tool must answer with the
 * guard's code and must not have reached the data layer. A new tool without a sample below fails the coverage check, so
 * the property cannot silently lapse.
 */

const dbTouched = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: new Proxy(
    {},
    {
      get(_target, property) {
        dbTouched.calls.push(String(property));
        throw new Error('the database was touched before the guard');
      },
    },
  ),
}));
vi.mock('@/lib/auth/helpers', () => {
  const refuse = () => Promise.reject(Object.assign(new Error('Admin access required'), { statusCode: 403, code: 'forbidden' }));
  return {
    requireAdmin: vi.fn(refuse),
    requireAnyAdmin: vi.fn(refuse),
    requireResourceAdmin: vi.fn(refuse),
    requireDraftAdmin: vi.fn(refuse),
    requireFormatViewer: vi.fn(refuse),
    AuthError: class AuthError extends Error {},
  };
});
vi.mock('@/lib/ruleset-studio/guards', () => {
  const refuse = () => Promise.reject(Object.assign(new Error('Admin access required'), { statusCode: 403, code: 'forbidden' }));
  return { requireRulesetViewer: vi.fn(refuse), requireRulesetOwner: vi.fn(refuse), assertRulesetUsable: vi.fn(refuse) };
});

import { ALL_TOOLS, type RunnableTool } from '../index';
import type { ToolContext } from '../types';

const ID = '22222222-2222-4222-8222-222222222222';
const ID2 = '33333333-3333-4333-8333-333333333333';
const ctx: ToolContext = {
  role: 'site',
  maxPhase: 5,
  offeredTools: [],
  conversationId: ID,
  now: () => new Date('2026-10-26T10:00:00Z'),
  timeZone: 'Europe/Berlin',
  locale: 'en',
  ports: {},
};

/** One argument object per runnable tool that passes its schema. */
const SAMPLES: Record<string, unknown> = {
  whoami: {},
  dex_lookup: { kind: 'species', query: 'Kingambit' },
  format_catalog: {},
  ruleset_preset_get: { preset: 'gen9ou' },
  engine_support: {},
  resolve_date: { anchor: 'today' },
  league_list: {},
  league_get: { league_id: ID },
  league_roster_get: { league_id: ID },
  player_search: { query: 'mara' },
  phase_get: { tournament_id: ID },
  tournament_get: { tournament_id: ID },
  tournament_list: {},
  tournament_bracket_preview: { tournament_id: ID },
  ruleset_list: {},
  ruleset_get: { ruleset_id: ID },
  ruleset_usage: { ruleset_id: ID },
  ruleset_version_get: { ruleset_id: ID, version_no: 1 },
  league_format_status: { league_id: ID },
  attachable_formats: {},
  format_list: {},
  format_get: { format_id: ID },
  draft_setup_get: { league_id: ID },
  draft_pool_state_get: { pool_id: ID },
  pointbuy_list_get: {},
  pool_template_list: {},
  outward_effects_preview: { action: 'start_phase' },
  plan_get: {},
  plan_validate: {},
  ruleset_build_preview: { base_preset: 'gen9ou' },
  ruleset_test_team: { ruleset_id: ID, team: [{ species: 'Kingambit' }] },
  ruleset_publish_preview: { ruleset_id: ID },
  ruleset_pin_impact_preview: { ruleset_id: ID, to_version_no: 2, targets: [{ kind: 'season', id: ID2 }] },
  league_create_preview: { name: 'Autumn League', format_type: 'singles' },
  phase_create_preview: { league_id: ID, name: 'Group stage', bracket_type: 'round_robin', ruleset_id: ID2 },
  tournament_create_preview: { name: 'Cup', bracket_type: 'single_elim', ruleset_id: ID },
  round_schedule_preview: { participant_count: 8 },
};

const runnable = ALL_TOOLS.filter((tool): tool is RunnableTool => tool.class === 'R' || tool.class === 'P');

beforeEach(() => {
  dbTouched.calls.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('every runnable tool is guarded before it reads', () => {
  it('has a sample for each runnable tool, and none for a tool that is gone', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(runnable.map((tool) => tool.name).sort());
  });

  it('declares a guard kind on every tool', () => {
    for (const tool of runnable) {
      expect(['site', 'any', 'season', 'tournament', 'draft', 'formatViewer', 'rulesetViewer', 'rulesetOwner', 'rulesetUsable'], tool.name).toContain(tool.guardKind);
    }
  });

  for (const tool of runnable) {
    it(`${tool.name}: a refused guard answers forbidden and the database is never touched`, async () => {
      const result = await tool.run(SAMPLES[tool.name], ctx);
      expect(result, tool.name).toMatchObject({ ok: false });
      // Plan tools answer tool_not_available without a port, but only AFTER their guard; the others are refused by it.
      expect((result as { code: string }).code, tool.name).toBe('forbidden');
      expect(dbTouched.calls, `${tool.name} reached the data layer first`).toEqual([]);
    });
  }
});
