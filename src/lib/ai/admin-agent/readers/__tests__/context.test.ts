import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));
vi.mock('@/lib/auth/helpers', () => ({ requireAdmin: vi.fn(), requireAnyAdmin: vi.fn(), requireResourceAdmin: vi.fn(), requireDraftAdmin: vi.fn(), requireFormatViewer: vi.fn() }));
vi.mock('@/lib/ruleset-studio/guards', () => ({ requireRulesetViewer: vi.fn(), requireRulesetOwner: vi.fn(), assertRulesetUsable: vi.fn() }));
vi.mock('@/lib/auth/admin-scope', () => ({ getAdminScope: vi.fn(), scopeAllowsSeason: vi.fn() }));

import { getAdminScope } from '@/lib/auth/admin-scope';
import { requireAnyAdmin } from '@/lib/auth/helpers';
import type { SessionPlayer } from '@/types/auth';
import type { ToolContext } from '../../registry/types';
import { dexLookup, engineSupport, formatCatalog, resolveDate, rulesetPresetGet, whoami } from '../context';
import { resolveRelativeDate } from '../resolve-date';

const ADMIN: SessionPlayer = { playerId: '11111111-1111-4111-8111-111111111111', name: 'Site‮ Admin', isAdmin: true, isResourceAdmin: false, isCreator: false, psUsername: '', championsUsername: '', avatarUrl: null, status: 'active' };
const ctx: ToolContext = { role: 'site', maxPhase: 1, offeredTools: ['whoami', 'league_get'], conversationId: null, now: () => new Date('2026-10-26T10:00:00Z'), timeZone: 'Europe/Berlin', locale: 'en', ports: {} };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAnyAdmin).mockResolvedValue(ADMIN);
  vi.mocked(getAdminScope).mockResolvedValue({ playerId: ADMIN.playerId, isSiteAdmin: true, seasonIds: null, tournamentIds: null });
});

type Ok<T> = { ok: true; data: T };

describe('whoami', () => {
  it('reports the tier, the scope, the phase and the offered tools', async () => {
    const result = (await whoami.run({}, ctx)) as Ok<Record<string, unknown>>;
    expect(result.data).toEqual({
      tier: 'site_admin',
      label: 'Site Admin',
      toolset: 'site',
      max_phase: 1,
      league_scope: { all: true, count: 0, ids: [], truncated: false },
      tournament_scope: { all: true, count: 0, ids: [], truncated: false },
      offered_tools: ['whoami', 'league_get'],
    });
  });

  it('lists a resource admin\'s scope and cuts a long one', async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    vi.mocked(requireAnyAdmin).mockResolvedValue({ ...ADMIN, isAdmin: false, isResourceAdmin: true });
    vi.mocked(getAdminScope).mockResolvedValue({ playerId: ADMIN.playerId, isSiteAdmin: false, seasonIds: ids, tournamentIds: [] });
    const result = (await whoami.run({}, { ...ctx, role: 'scoped' })) as Ok<{ tier: string; league_scope: { count: number; ids: string[]; truncated: boolean } }>;
    expect(result.data.tier).toBe('resource_admin');
    expect(result.data.league_scope).toMatchObject({ count: 60, truncated: true });
    expect(result.data.league_scope.ids).toHaveLength(50);
  });
});

describe('dex_lookup', () => {
  it('finds a species by name or id and lists its formes (banning a base does not ban a forme)', async () => {
    const result = (await dexLookup.run({ kind: 'species', query: 'Rotom' }, ctx)) as Ok<{ found: boolean; match: { id: string; name: string }; formes: Array<{ id: string }> }>;
    expect(result.data.found).toBe(true);
    expect(result.data.match).toEqual({ id: 'rotom', name: 'Rotom' });
    expect(result.data.formes.map((f) => f.id)).toEqual(expect.arrayContaining(['rotom', 'rotomwash', 'rotomheat']));
  });

  it('finds moves, items and abilities', async () => {
    for (const [kind, query, id] of [['move', 'Stealth Rock', 'stealthrock'], ['item', 'Focus Sash', 'focussash'], ['ability', 'Moody', 'moody']] as const) {
      const result = (await dexLookup.run({ kind, query }, ctx)) as Ok<{ match: { id: string } }>;
      expect(result.data.match.id).toBe(id);
    }
  });

  it('suggests close names on a miss and never invents a match', async () => {
    const result = (await dexLookup.run({ kind: 'species', query: 'Kingamb' }, ctx)) as Ok<{ found: boolean; match: unknown; suggestions: Array<{ id: string }> }>;
    expect(result.data.found).toBe(false);
    expect(result.data.match).toBeNull();
    expect(result.data.suggestions.map((s) => s.id)).toContain('kingambit');
  });

  it('says a Pokémon of an earlier generation needs the National Dex instead of "unknown"', async () => {
    const standard = (await dexLookup.run({ kind: 'species', query: 'Dracozolt', gen: 9 }, ctx)) as Ok<{ found: boolean; note: string }>;
    expect(standard.data.found).toBe(false);
    expect(standard.data.note).toBe('past_species_use_national');
    const national = (await dexLookup.run({ kind: 'species', query: 'Dracozolt', national: true }, ctx)) as Ok<{ found: boolean; match: { id: string }; earliest_gen: number }>;
    expect(national.data.found).toBe(true);
    expect(national.data.match.id).toBe('dracozolt');
    expect(national.data.earliest_gen).toBe(8);
  });
});

describe('format_catalog and ruleset_preset_get', () => {
  it('searches the catalog by words and carries the data pins', async () => {
    const result = (await formatCatalog.run({ query: 'gen 9 ou' }, ctx)) as Ok<{ presets: { items: Array<{ id: string }> }; provenance: Record<string, string> }>;
    expect(result.data.presets.items.map((p) => p.id)).toContain('gen9ou');
    expect(result.data.provenance.preset_data_repo).toBe('smogon/pokemon-showdown');
    expect(result.data.provenance.preset_data_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(result.data.provenance.preset_rules_version).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  it('filters by generation, source and family, and cuts at 60 with a truncated flag', async () => {
    const draft = (await formatCatalog.run({ source: 'smogon-draft' }, ctx)) as Ok<{ presets: { items: Array<{ source: string }> } }>;
    expect(draft.data.presets.items.length).toBeGreaterThan(0);
    expect(draft.data.presets.items.every((p) => p.source === 'smogon-draft')).toBe(true);
    const all = (await formatCatalog.run({}, ctx)) as Ok<{ presets: { items: unknown[]; total: number; truncated: boolean; cap: number } }>;
    expect(all.data.presets.items).toHaveLength(60);
    expect(all.data.presets).toMatchObject({ truncated: true, cap: 60 });
    expect(all.data.presets.total).toBeGreaterThan(60);
  });

  it('resolves a preset to its clauses and lists, cut with a count', async () => {
    const result = (await rulesetPresetGet.run({ preset: 'gen9ou' }, ctx)) as Ok<{ found: boolean; preset: { clauses: string[]; pokemon: { mode: string; count: number; ids: string[]; truncated: boolean } } }>;
    expect(result.data.found).toBe(true);
    expect(result.data.preset.clauses).toContain('speciesclause');
    expect(result.data.preset.pokemon.mode).toBe('block');
    expect(result.data.preset.pokemon.count).toBeGreaterThan(result.data.preset.pokemon.ids.length - 1);
    expect(result.data.preset.pokemon.ids.length).toBeLessThanOrEqual(150);
  });

  it('reports an unknown preset instead of falling back to a blank one', async () => {
    const result = (await rulesetPresetGet.run({ preset: 'gen9notaformat' }, ctx)) as Ok<{ found: boolean; preset: unknown }>;
    expect(result.data).toEqual({ found: false, preset: null, tour_overlay: null });
    expect(((await rulesetPresetGet.run({ preset: 'blank' }, ctx)) as Ok<{ found: boolean }>).data.found).toBe(false);
  });

  it('returns the tour overlay only when asked, and says when a preset has none', async () => {
    const without = (await rulesetPresetGet.run({ preset: 'gen9ou' }, ctx)) as Ok<{ tour_overlay: unknown }>;
    expect(without.data.tour_overlay).toBeNull();
    const none = (await rulesetPresetGet.run({ preset: 'gen9ou', tour_overlay: true }, ctx)) as Ok<{ tour_overlay: { available: boolean } }>;
    expect(none.data.tour_overlay.available).toBe(false);
  });
});

describe('engine_support', () => {
  it('states that a round robin is one circle and a double round robin is refused', async () => {
    const result = (await engineSupport.run({}, ctx)) as Ok<{ rows: Array<{ key: string; supported: boolean; limit: number | null }> }>;
    const row = result.data.rows.find((r) => r.key === 'double_round_robin');
    expect(row).toMatchObject({ supported: false, limit: 1 });
    expect(result.data.rows.map((r) => r.key)).toEqual(expect.arrayContaining(['legacy_draft_roster_size', 'start_date_is_a_label', 'public_on_creation']));
  });
});

describe('resolve_date', () => {
  // Monday 2026-10-26, 12:00 in Berlin.
  const MONDAY = new Date('2026-10-26T11:00:00Z');

  it('returns both candidates and asks when "next Monday" is said on a Monday', () => {
    const result = resolveRelativeDate({ anchor: 'weekday', weekday: 'monday', relation: 'next' }, MONDAY, 'Europe/Berlin');
    expect(result).toMatchObject({ today: '2026-10-26', today_weekday: 'monday', date: null, ambiguous: true, candidates: ['2026-10-26', '2026-11-02'] });
  });

  it('resolves "next Monday" on another day to the first Monday after today', () => {
    const thursday = new Date('2026-10-29T09:00:00Z');
    expect(resolveRelativeDate({ anchor: 'weekday', weekday: 'monday', relation: 'next' }, thursday, 'Europe/Berlin')).toMatchObject({ date: '2026-11-02', ambiguous: false, weekday: 'monday' });
  });

  it('"upcoming" is always strictly after today, "this" is the one in the current Monday-to-Sunday week', () => {
    expect(resolveRelativeDate({ anchor: 'weekday', weekday: 'monday', relation: 'upcoming' }, MONDAY, 'Europe/Berlin').date).toBe('2026-11-02');
    const thursday = new Date('2026-10-29T09:00:00Z');
    expect(resolveRelativeDate({ anchor: 'weekday', weekday: 'monday', relation: 'this' }, thursday, 'Europe/Berlin')).toMatchObject({ date: '2026-10-26', in_past: true });
    expect(resolveRelativeDate({ anchor: 'weekday', weekday: 'sunday', relation: 'this' }, thursday, 'Europe/Berlin')).toMatchObject({ date: '2026-11-01', in_past: false });
  });

  it('computes today, tomorrow and in_days', () => {
    expect(resolveRelativeDate({ anchor: 'today' }, MONDAY, 'Europe/Berlin').date).toBe('2026-10-26');
    expect(resolveRelativeDate({ anchor: 'tomorrow' }, MONDAY, 'Europe/Berlin')).toMatchObject({ date: '2026-10-27', weekday: 'tuesday' });
    expect(resolveRelativeDate({ anchor: 'in_days', days: 7 }, MONDAY, 'Europe/Berlin').date).toBe('2026-11-02');
  });

  it('uses the admin\'s zone for "today", also across the date line, and a DST change moves nothing', () => {
    // 23:30 UTC on Sunday is already Monday in Berlin and still Sunday in Los Angeles.
    const lateSunday = new Date('2026-10-25T23:30:00Z');
    expect(resolveRelativeDate({ anchor: 'today' }, lateSunday, 'Europe/Berlin')).toMatchObject({ today: '2026-10-26', today_weekday: 'monday' });
    expect(resolveRelativeDate({ anchor: 'today' }, lateSunday, 'America/Los_Angeles')).toMatchObject({ today: '2026-10-25', today_weekday: 'sunday' });
    // Europe ends DST on Sunday 2026-10-25: a week from Saturday the 24th is still the 31st.
    expect(resolveRelativeDate({ anchor: 'in_days', days: 7 }, new Date('2026-10-24T10:00:00Z'), 'Europe/Berlin').date).toBe('2026-10-31');
  });

  it('falls back to Europe/Berlin for an unknown zone', () => {
    expect(resolveRelativeDate({ anchor: 'today' }, MONDAY, 'Not/AZone')).toMatchObject({ time_zone: 'Europe/Berlin', today: '2026-10-26' });
  });

  it('is exposed as a tool with the argument checks', async () => {
    expect(await resolveDate.run({ anchor: 'in_days' }, ctx)).toMatchObject({ ok: false, code: 'validation_failed' });
    expect(await resolveDate.run({ anchor: 'weekday', weekday: 'monday' }, ctx)).toMatchObject({ ok: false, code: 'validation_failed' });
    const ok = (await resolveDate.run({ anchor: 'weekday', weekday: 'monday', relation: 'next' }, ctx)) as Ok<{ ambiguous: boolean; time_zone: string }>;
    expect(ok.data).toMatchObject({ ambiguous: true, time_zone: 'Europe/Berlin' });
  });
});
